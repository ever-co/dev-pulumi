import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as eks from '@pulumi/eks';
import * as k8s from '@pulumi/kubernetes';
import * as cloudflare from '@pulumi/cloudflare';

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
    version:'1.16',
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
    },
}, { provider: cluster.provider} );

const jenkins_ebs = new aws.ebs.Volume("jenkins-home", {
    availabilityZone: "us-east-1a", 
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
};

// Needed for Jenkins Agent
const service_account = new k8s.yaml.ConfigFile('jenkins-service-acc', {
    file: "service-account.yaml",
}, { provider: cluster.provider });

const deployment = new k8s.apps.v1.Deployment("jenkins-deployment", {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
        clusterName: cluster.eksCluster.name,
        namespace: jenkins_namespace.metadata.name,
    },
    spec: {
        replicas: 1,
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
                containers: [
                    {
                        name: "jenkins",
                        image: "jenkins/jenkins:lts",
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
                            }
                        ],
                    },
                ],
                volumes: [
                    {
                        name: "jenkins-home",
                        awsElasticBlockStore: {
                            volumeID: jenkins_ebs.id,
                            fsType: "ext4",
                        }
                    }
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

export const externalIp = service.status.loadBalancer.ingress[0].hostname;
export const kubeconfig = cluster.kubeconfig;

const ci_ever = new cloudflare.Record('ci-ever', {
    name: "ci.ever.co",
    type: "CNAME",
    value: externalIp,
    zoneId: `${config.require("zoneId")}`,
});
