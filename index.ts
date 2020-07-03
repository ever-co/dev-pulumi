import * as awsx from '@pulumi/awsx';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as eks from '@pulumi/eks';
import * as k8s from '@pulumi/kubernetes';
import * as jenkins from "./jenkins";

const managedPolicyArns: string[] = [
	'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
	'arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
	'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly'
];

//function createAndAttachRole(name: string): aws.iam.Role {
//	const role = new aws.iam.Role(name, {
//		assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
//			Service: 'ec2.amazonaws.com'
//		})
//	});
//
//	let counter = 0;
//
//	for (const policy of managedPolicyArns) {
//		const rolePolicyAttachment = new aws.iam.RolePolicyAttachment(
//			`${name}-policy-${counter++}`,
//			{
//				policyArn: policy,
//				role
//			}
//		);
//	}
//
//	return role;
//}

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
});

const kubeconfig = cluster.kubeconfig;

const clusterName = cluster.core.cluster.name;

const ns = new k8s.core.v1.Namespace(
    'jenkins',
    {},
    { provider: cluster.provider }
);

const namespace = ns.metadata.name;

const config = new pulumi.Config("jenkins");
const instance = new jenkins.Instance({
    name: pulumi.getStack(),
    credentials: {
        username: config.require("username"),
        password: config.require("password"),
    },
    resources: {
            memory: "512Mi",
            cpu: "100m",
    }
});
export const externalIp = instance.externalIp;
