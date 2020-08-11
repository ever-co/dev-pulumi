import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import * as eks from '@pulumi/eks';
import * as k8s from '@pulumi/kubernetes';
import * as cloudflare from '@pulumi/cloudflare';

require('dotenv').config();


const vpc = new awsx.ec2.Vpc('ever-dev-vpc', {
	cidrBlock: '172.16.0.0/16',
	subnets: [
		{
			type: 'public',
			tags: {
				// TODO: we need to know AWS Cluster name to put in here!!!
				// Next tags needed so k8s found public Subnets where to add external ELB
				// see https://github.com/kubernetes/kubernetes/issues/29298
				KubernetesCluster: 'ever-dev',
				'kubernetes.io/role/elb': ''
			}
		},
		{ type: 'private' }
	]
});

const cluster = new eks.Cluster('ever-dev', {
    name: 'ever-dev',
    vpcId: vpc.id,
    publicSubnetIds: vpc.publicSubnetIds,
    privateSubnetIds: vpc.privateSubnetIds,
    storageClasses: 'gp2',
    instanceType: 'm5.xlarge',
    desiredCapacity: 3,
    minSize: 1,
    maxSize: 3,
    version:'1.17',
    enabledClusterLogTypes: [
        'api',
        'audit',
        'authenticator',
        'controllerManager',
        'scheduler'
    ],
    skipDefaultNodeGroup: false,
}, /* { protect: true } */ );

const jenkinsNamespace = new k8s.core.v1.Namespace("jenkins-ns", {
    metadata: {
        name: "jenkins",
        clusterName: cluster.eksCluster.name,
        labels: {
            app: "jenkins",
        }
    },
}, { provider: cluster.provider} );

const jenkinsEbs = new aws.ebs.Volume("jenkins-home", {
    availabilityZone: "us-east-1a", 
    size: 100,
    type: "gp2",
    tags: {
        Name: "jenkins-home",
    },
}, /* { protect: true } */);

const args = {
    name: "jenkins",
    domain: "ci.ever.co",
};

// Needed for Jenkins Agent
const service_account = new k8s.yaml.ConfigFile('jenkins-service-acc', {
    file: "jenkins/service-account.yaml",
}, { provider: cluster.provider });

const apiRepository = new aws.ecr.Repository('gauzy-api', {
    name: "gauzy-api",
}, { protect: true });

const webappRepository = new aws.ecr.Repository('gauzy-webapp', {
    name: "gauzy-webapp",
}, { protect: true });

const jenkinsRepository = new aws.ecr.Repository('jenkins', {
    name: "jenkins",
}, { protect: true });

const imageLifecycleAPI = new aws.ecr.LifecyclePolicy('gauzy-api', {
    policy: {
        rules: [{
            rulePriority: 1,
            action: {
                type: "expire",
            },
            selection: {
                tagStatus: "untagged",
                countType: "sinceImagePushed",
                countUnit: "days",
                countNumber: 2,
            },
        }],
    },
    repository: "gauzy-api",
});

const imageLifecycleWebapp = new aws.ecr.LifecyclePolicy('gauzy-webapp', {
    policy: {
        rules: [{
            rulePriority: 1,
            action: {
                type: "expire",
            },
            selection: {
                tagStatus: "untagged",
                countType: "sinceImagePushed",
                countUnit: "days",
                countNumber: 7,
            },
        }],
    },
    repository: "gauzy-webapp",
});

const imageLifecycleJenkins = new aws.ecr.LifecyclePolicy('jenkins', {
    policy: {
        rules: [{
            action: {
                type: "expire",
            },
            rulePriority: 1,
            selection: {
                tagStatus: "untagged",
                countType: "imageCountMoreThan",
                countNumber: 3,
            },
        }],
    },
    repository: "jenkins",
});

const certificate = new aws.acm.Certificate("jenkins", {
    domainName: args.domain,
    validationMethod: "DNS",
});

const validate = new cloudflare.Record("jenkins-validation", {
    name: certificate.domainValidationOptions[0].resourceRecordName,
    type: certificate.domainValidationOptions[0].resourceRecordType,
    value: certificate.domainValidationOptions[0].resourceRecordValue,
    zoneId: `${process.env.ZONE_ID}`,
});

const jenkinsAWSUser = new aws.iam.User('jenkins', {
    name: "jenkins",
    permissionsBoundary: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser",
    tags: {
        Name: "jenkins",
    },
}, { protect: true });

const jenkinsPolicy = new aws.iam.PolicyAttachment('jenkins', {
    policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser",
    users: [ "jenkins" ],
});

const credentials = new aws.iam.AccessKey('jenkins', {
    user: "jenkins",
}, { protect: true });

const jenkinsDeployment = new k8s.apps.v1.Deployment("jenkins-deployment", {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
        clusterName: cluster.eksCluster.name,
        name: "jenkins",
        namespace: jenkinsNamespace.metadata.name,
    },
    spec: {
        replicas: 1,
        strategy: {
            type: "Recreate",
        },
        selector: {
            matchLabels: {
                app: args.name,
            }
        },
        template: {
            metadata: {
                labels: {
                    app: args.name,
                },
            },
            spec: {
                serviceAccountName: "jenkins", // Needed for Jenkins agent
                securityContext: { // change volume group owner to Jenkins
                    fsGroup: 1000,
                },
                nodeSelector: {
                    "failure-domain.beta.kubernetes.io/zone": jenkinsEbs.availabilityZone,
                },
                containers: [
                    {
                        name: "jenkins",
                        image: "jenkins/jenkins:latest",
                        imagePullPolicy: "Always",
                        ports: [
                            {
                                containerPort: 8080,
                            },
                            {
                                containerPort: 50000, // This port is necessary for agent pods
                            },
                        ],
                        volumeMounts: [
                            {
                                name: "jenkins-home",
                                mountPath: "/var/jenkins_home",
                            },
                        ],
                    },
                ],
                volumes: [
                    {
                        name: "jenkins-home",
                        awsElasticBlockStore: {
                            volumeID: jenkinsEbs.id,
                            fsType: "ext4",
                        },
                    },
                ],
            },
        },
    },
}, {
    provider: cluster.provider,
    dependsOn: [jenkinsEbs, service_account],
});

const jenkinsService = new k8s.core.v1.Service("jenkins-service", {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
        name: args.name,
        clusterName: cluster.eksCluster.name,
        namespace: jenkinsNamespace.metadata.name,
        annotations: {
            "service.beta.kubernetes.io/aws-load-balancer-ssl-cert": certificate.arn,
            "service.beta.kubernetes.io/aws-load-balancer-backend-protocol": "http",
        },
    },
    spec: {
        type: "LoadBalancer",
        ports: [
            {
                name: "https",
                port: 443,
                targetPort: 8080,
            },
            {
                name: "agent", // for agent pods
                port: 50000,
                targetPort: 50000,
            },
        ],
        selector: {
            app: args.name,
        }
    },
}, {
    provider: cluster.provider,
    dependsOn: [jenkinsDeployment],
});

const keyPair = new aws.ec2.KeyPair('jenkins', {
    keyName: `${args.name}-node`,
    publicKey: `${process.env.PUBLIC_KEY}`,
    tags: {
        Name: args.name,
    },
});

const instances = new aws.ec2.Instance('jenkins', {
    ami: "ami-0ac80df6eff0e70b5", // Ubuntu Server 18.04 AMI
    availabilityZone: "us-east-1a",
    associatePublicIpAddress: true,
    keyName: keyPair.keyName,
    instanceType: "m5.xlarge", // 2 vCPU 15.5GB RAM
    rootBlockDevice: {
        volumeSize: 200,
    },
    tags: {
        Name: "jenkins",
    }
});

export const instanceIp = instances.publicIp;
export const accessId = credentials.id;
export const secretKey = credentials.secret;
export const externalIp = jenkinsService.status.loadBalancer.ingress[0].hostname;
export const kubeconfig = cluster.kubeconfig;

const ci_ever = new cloudflare.Record('ci-ever', {
    name: args.domain,
    type: "CNAME",
    value: externalIp,
    zoneId: `${process.env.ZONE_ID}`,
});
