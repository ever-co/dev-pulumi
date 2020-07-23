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

#### Make sure deployment script is executable
```bash
$ chmod +x deploy.sh
```

#### See planned changes  
```
$ ./deploy.sh --preview 
```

#### Apply changes    
```
$ ./deploy.sh --apply
```