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

// const jenkins_volume = new aws.ebs.Volume("jenkins", {
//     availabilityZone: "us-east-1a",
//     size: 100,
//     tags: {
//         Name: "jenkins",
//     },
// }, { protect: true });

const allVpcSubnetsIds = vpc.privateSubnetIds.concat(
	vpc.publicSubnetIds
);

const cluster = new eks.Cluster('ever-dev', {
    tags: {
        Name: 'ever-dev'
    },
    version: '1.16',
    vpcId: vpc.id,
    subnetIds: allVpcSubnetsIds,
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

const args = {
    "name": "jenkins",
    // Values for helm chart
    "values": {
        "master": {
            "serviceType": "LoadBalancer",
            "overwriteConfig": true,
            "servicePort": 80,
        },
        "persistence": {
            "storageClass": "gp2",
        }
    }
};
// const volumeName = jenkins_volume.id;

const jenkins = new k8s.helm.v2.Chart("jenkins", {
    repo: "stable",
    chart: "jenkins",
    version: "2.3.0",
    values: args.values,

}, { provider: cluster.provider });
 
const deployment = jenkins.getResource("v1/Service", "jenkins");
  
export const kubeconfig = cluster.kubeconfig;
export const externalIp = deployment.status.loadBalancer.ingress[0].ip;
