#!/bin/bash

# This shell script automates the configuring of instances and Jenkins
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color
usage() {
    cat << EOF
    -a | --apply
    Apply planned changes

    --reset-hosts
    Reset or create the hosts file for Ansible Playbook
    
    -r | --refresh
    Refreshes pulumi stack to check if there are any changes

    -p | --preview
    Display planned changes without applying them

    -c | --configure-instance
    Configures the EC2 Instance to be used as Jenkins Build Agent
EOF
}

reset_hosts() {
    cat << EOF > $(pwd)/hosts
[instances]
[instances:vars]
ansible_python_interpreter=/usr/bin/python3
EOF
    echo -e "${GREEN}Hosts file for Ansible has been reset to default state.${NC}"
}

pulumi_refresh() {
    echo -e "${YELLOW}Refreshing Pulumi stack state...${NC}"
    pulumi refresh --yes
}

pulumi_preview() {
    echo -e "${YELLOW}Getting planned changes...${NC}"
    pulumi preview
}

apply() {
    echo -e "${PURPLE}Applying changes... CTRL+C NOW if you want to abort!${NC}"
    sleep 5
    pulumi up --yes # Run Pulumi
}

run_playbook() {
    set -o pipefail
    # Check for .env
    if [[ -f ".env" ]]; then
        ssh_key="$(grep '^PRIVATE_KEY_PATH' .env | cut -d'=' -f2)"
        if [ "$?" -gt 0 ]; then
            echo -e "${RED}Could not get variable PRIVATE_KEY_PATH!${NC}" > /dev/stderr
            exit 1
        fi
    else
        echo -e "${RED}.env file is not present!${NC}" > /dev/stderr
        exit 1
    fi
    # Check for hosts file
    if [ ! -f "$(pwd)/hosts" ]; then
        reset_hosts
    fi
    instanceIp=$(pulumi stack output instanceIp 2> /dev/null) # Get the Ip of the node
    if [ $? -eq 0 ]; then
        sed -i "/^\[instances\]/a $instanceIp" $(pwd)/hosts # Add the IP to the hosts file
    fi

    echo -e "${BLUE}Firing Ansible playbook...${NC}"
    if [[ "$1" == "sonar" ]]; then
        ansible-playbook sonarqube/playbook.yaml -i $(pwd)/hosts --key-file="${ssh_key}"
    else
        ansible-playbook jenkins/playbook.yaml -i $(pwd)/hosts --key-file="${ssh_key}"
    fi
    rm -f $(pwd)/hosts # Get rid of hosts file
}

which pulumi > /dev/null 2> /dev/null
if [ $? -gt 0 ]; then
    echo -e "${RED}ERROR! Pulumi is either not installed properly or not in PATH!${NC}"
    exit 1
fi

which ansible-playbook > /dev/null 2> /dev/null
if [ $? -gt 0 ]; then
    echo -e "${RED}ERROR! Ansible is either not installed properly or not in PATH!${NC}"
    exit 1
fi

while [[ "$1" != "" ]]; do
    case $1 in 
        --reset-hosts) reset_hosts; exit 0;;
        -h | --help) usage; exit 0 ;;
        -r | --refresh) pulumi_refresh; ;;
        -p | --preview) pulumi_preview; exit 0 ;;
        -a | --apply) apply; exit 0 ;;
        --configure-jenkins) run_playbook; ;;
        --configure-sonar) run_playbook "sonar"; ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done