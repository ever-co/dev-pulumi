# dev-pulumi
Deploy and Manage our company Development resources on Clouds

## Instructions
#### Install dependencies:  
```
$ npm install
```

#### Create Pulumi Stack using:  
```
$ pulumi stack init stackname
```

#### Set Cloudflare token and zone id to update DNS records
```
$ pulumi config set cloudflare:apiToken <token>
$ pulumi config set jenkins-eks:zoneId <zoneId>
```

#### Set the SSH Keypair you want to use for the instance
```
$ pulumi config set jenkins-eks:publicKey <yourpublickey>
```

#### Set AWS Region  
```
$ pulumi config set aws:region us-east-1
```

#### Get AWS Credentials from AWS Console IAM or if you have awscli already set up:    
```
$ cat ~/.aws/credentials
```

#### Export AWS Credentials as environmental variables (temporarily, not in .bashrc or .zshrc)  
```bash
$ export AWS_ACCESS_KEY_ID=<YOUR_ACCESS_KEY_ID>
$ export AWS_SECRET_ACCESS_KEY=<YOUR_SECRET_ACCESS_KEY>
```

#### See planned changes  
```
$ pulumi preview 
```

#### Apply changes    
```
$ pulumi up
```

#### Add the IP address of the instance to your Ansible Inventory
```
$ pulumi stack output instanceIp
```

```
[instances]
// HOST IP GOES HERE // (No slashes)

[instances:vars]
ansible_python_interpreter=/usr/bin/python3
```

#### Run Ansible Playbook to configure the instance for Jenkins
```
$ ansible-playbook setup_node.yaml -i hosts --key-file="/your/ssh/key"
```