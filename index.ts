import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as eks from '@pulumi/eks';
import * as k8s from '@pulumi/kubernetes';

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
    version: '1.16',
    vpcId: vpc.id,
    publicSubnetIds: vpc.publicSubnetIds,
    privateSubnetIds: vpc.privateSubnetIds,
    instanceType: 't3.medium',
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 2,
    storageClasses: 'gp2',
    enabledClusterLogTypes: [
        'api',
        'audit',
        'authenticator',
        'controllerManager',
        'scheduler'
    ],
    skipDefaultNodeGroup: false
}, /* { protect: true } */ );

const jenkins_namespace = new k8s.core.v1.Namespace("jenkins", {
    metadata: {
        name: "jenkins",
        clusterName: cluster.eksCluster.name,
    },
}, { provider: cluster.provider} );

const jenkins_ebs = new aws.ebs.Volume("jenkins-home", {
    availabilityZone: "us-east-1b",
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

const jenkins_volume_claim = new k8s.core.v1.PersistentVolumeClaim("jenkins-pvc", {
    metadata: {
        name: "jenkins-pvc",
        clusterName: cluster.eksCluster.name,
        namespace: jenkins_namespace.metadata.name,
    },
    spec: {
        accessModes: ["ReadWriteOnce"],
        resources: {
            requests: {
                storage: "100Gi",
            },
        },
        storageClassName: "gp2",
        volumeName: jenkins_volume.metadata.name,
    },
}, {
    provider: cluster.provider,
    dependsOn: [jenkins_volume],
});

const args = {
    name: "jenkins",
};

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
                securityContext: { // change volume group owner to Jenkins
                    fsGroup: 1000,
                },
                containers: [
                    {
                        name: "jenkins",
                        image: "jenkins/jenkins:lts",
                        ports: [
                            {
                                containerPort: 80,
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
                        // persistentVolumeClaim: {
                        //     claimName: jenkins_volume_claim.metadata.name,
                        // },
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
    dependsOn: [jenkins_volume_claim, jenkins_ebs],
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
                port: 80,
                targetPort: 80,
            }
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
const elbHostedZoneId = pulumi.output(aws.elb.getHostedZoneId()).id;

const ci_ever = new aws.route53.Record("ci-ever", {
    name: `${externalIp}`,
    records: ["ci.ever.co"],
    setIdentifier: "ci",
    ttl: 300,
    type: "CNAME",
    zoneId: elbHostedZoneId,
});

export const kubeconfig = cluster.kubeconfig;
