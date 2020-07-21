import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as eks from '@pulumi/eks';
import * as k8s from '@pulumi/kubernetes';
import * as cloudflare from '@pulumi/cloudflare';
import * as docker from '@pulumi/docker';

const config = new pulumi.Config();

const managedPolicyArns: string[] = [
	'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
	'arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
	'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly'
];

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
    instanceType: 't3.medium',
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 2,
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

const jenkins_namespace = new k8s.core.v1.Namespace("jenkins", {
    metadata: {
        name: "jenkins",
        clusterName: cluster.eksCluster.name,
        labels: {
            app: "jenkins",
        }
    },
}, { provider: cluster.provider} );

const ebsAZ: string = "us-east-1a";

const jenkins_ebs = new aws.ebs.Volume("jenkins-home", {
    availabilityZone: ebsAZ, 
    size: 100,
    type: "gp2",
    tags: {
        name: "jenkins-home",
    },
}, /* { protect: true } */);

const jenkins_volume = new k8s.core.v1.PersistentVolume("jenkins-volume", {
    metadata: {
        clusterName: cluster.eksCluster.name,
        namespace: jenkins_namespace.metadata.name,
    },
    spec: {
        // AWS EBS only supports this mode, see: https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes 
        accessModes: ["ReadWriteOnce"],
        awsElasticBlockStore: {
            volumeID: jenkins_ebs.id,
            fsType: "ext4",
        },
        capacity: {
            storage: "100Gi",
        },
        storageClassName: "gp2",
    },
}, {
    provider: cluster.provider,
    dependsOn: [jenkins_ebs, cluster],
});


const args = {
    name: "jenkins",
    domain: "ci.ever.co",
};

// Needed for Jenkins Agent
const service_account = new k8s.yaml.ConfigFile('jenkins-service-acc', {
    file: "service-account.yaml",
}, { provider: cluster.provider });

const apiRepository = new aws.ecr.Repository('gauzy-api', {
    name: "gauzy/api",
});

const webappRepository = new aws.ecr.Repository('gauzy-webapp', {
    name: "gauzy/webapp",
});

const certificate = new aws.acm.Certificate("jenkins", {
    domainName: args.domain,
    validationMethod: "DNS",
});

const validate = new cloudflare.Record("jenkins-validation", {
    name: certificate.domainValidationOptions[0].resourceRecordName,
    type: certificate.domainValidationOptions[0].resourceRecordType,
    value: certificate.domainValidationOptions[0].resourceRecordValue,
    zoneId: `${config.require('zoneId')}`,
});

const jenkinsAWSUser = new aws.iam.User('jenkins', {
    name: "jenkins",
    permissionsBoundary: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser",
    tags: {
        Name: "jenkins",
    },
});

const jenkinsPolicy = new aws.iam.PolicyAttachment('jenkins', {
    policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser",
    users: [ "jenkins" ],
});

const credentials = new aws.iam.AccessKey('jenkins', {
    user: "jenkins",
});

const deployment = new k8s.apps.v1.Deployment("jenkins-deployment", {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
        clusterName: cluster.eksCluster.name,
        namespace: jenkins_namespace.metadata.name,
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
                    "failure-domain.beta.kubernetes.io/zone": ebsAZ,
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
                            volumeID: jenkins_ebs.id,
                            fsType: "ext4",
                        },
                    },
                ],
            },
        },
    },
}, {
    provider: cluster.provider,
    dependsOn: [jenkins_ebs, service_account],
});

const service = new k8s.core.v1.Service("jenkins-service", {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
        name: args.name,
        clusterName: cluster.eksCluster.name,
        namespace: jenkins_namespace.metadata.name,
        // annotations: {
        //     'service.beta.kubernetes.io/aws-load-balancer-additional-resource-tags': 'Name=gauzy-api-ingress',
		// 	'service.beta.kubernetes.io/aws-load-balancer-ssl-cert': certificate.arn,
		// 	'service.beta.kubernetes.io/aws-load-balancer-backend-protocol': 'http',
		// 	'service.beta.kubernetes.io/aws-load-balancer-ssl-ports': 'https',
		// 	'service.beta.kubernetes.io/aws-load-balancer-access-log-enabled': 'true',
		// 	'service.beta.kubernetes.io/aws-load-balancer-access-log-emit-interval': '5'
        // },
    },
    spec: {
        type: "LoadBalancer",
        ports: [
            {
                name: "http",
                port: 80,
                targetPort: 8080,
            },
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
    dependsOn: [deployment],
});

const keyPair = new aws.ec2.KeyPair('jenkins', {
    keyName: `${args.name}-node`,
    publicKey: config.require("publicKey"),
    tags: {
        name: args.name,
    },
});

const instances = new aws.ec2.Instance('jenkins', {
    ami: "ami-0ac80df6eff0e70b5", // Ubuntu Server 18.04 AMI
    availabilityZone: "us-east-1a",
    associatePublicIpAddress: true,
    keyName: keyPair.keyName,
    instanceType: "t3.large", // 2 vCPU 15.5GB RAM
    rootBlockDevice: {
        volumeSize: 200,
    },
    tags: {
        name: "jenkins",
    }
});

export const instanceIp = instances.publicIp;
export const accessId = credentials.id;
export const secretKey = credentials.secret;
export const externalIp = service.status.loadBalancer.ingress[0].hostname;
export const kubeconfig = cluster.kubeconfig;

const ci_ever = new cloudflare.Record('ci-ever', {
    name: args.domain,
    type: "CNAME",
    value: externalIp,
    zoneId: `${config.require("zoneId")}`,
});
