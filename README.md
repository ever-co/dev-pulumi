# dev-pulumi
Deploy and Manage our company Development resources on Clouds

## Instructions
### Install dependencies:  
```
$ npm install
```

### Create Pulumi Stack using:  
```
$ pulumi stack init stackname
```

### Set Jenkins administrator username and password:
```bash
$ pulumi config set jenkins:username username
$ pulumi config set jenkins:password password --secret
```

### Set AWS Region  
```
$ pulumi config set aws:region us-east-1
```

### Get AWS Credentials from AWS Console IAM or if you have awscli already set up:    
```
$ cat ~/.aws/credentials
```

### Export AWS Credentials as environmental variables (temporarily, not in .bashrc or .zshrc)  
```bash
$ export AWS_ACCESS_KEY_ID=<YOUR_ACCESS_KEY_ID>
$ export AWS_SECRET_ACCESS_KEY=<YOUR_SECRET_ACCESS_KEY>
```

### See planned changes  
```
$ pulumi preview 
```

### Apply changes    
```
$ pulumi up
```