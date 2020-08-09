#!/bin/bash

# This shell script automates the configuring of instances and Jenkins

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
    echo "Hosts file for Ansible has been reset to default state."
}

prompt_key() {
    echo "Enter the full path to SSH Key associated with instance:"
    read ssh_key
}

pulumi_refresh() {
    echo "Refreshing Pulumi stack state..."
    pulumi refresh --yes
}

pulumi_preview() {
    echo "Getting planned changes..."
    pulumi preview
}

apply() {
    echo "Applying changes... CTRL+C NOW if you want to abort!"
    sleep 5
    pulumi up --yes # Run Pulumi
}

run_playbook() {
    instanceIp=$(pulumi stack output instanceIp) # Get the Ip of the node
    if [ ! -f "$(pwd)/hosts" ]; then
        reset_hosts
    fi
    grep $instanceIp hosts > /dev/null 2> /dev/null # check if IP is already in the hosts file
    if [ $? -gt 0 ]; then
        sed -i "/^\[instances\]/a $instanceIp" $(pwd)/hosts # Add the IP to the hosts file
    fi
    prompt_key # Prompt for SSH key
    while [ ! -f "$ssh_key" ]; do
        prompt_key
    done

    ansible-playbook playbook.yaml -i $(pwd)/hosts --key-file="$ssh_key"
    rm -f $(pwd)/hosts # Get rid of hosts file
}

which pulumi > /dev/null 2> /dev/null
if [ $? -gt 0 ]; then
    echo "ERROR! Pulumi is either not installed properly or not in PATH!"
    exit 1
fi

which ansible-playbook > /dev/null 2> /dev/null
if [ $? -gt 0 ]; then
    echo "ERROR! Ansible is either not installed properly or not in PATH!"
    exit 1
fi

while [[ "$1" != "" ]]; do
    case $1 in 
        --reset-hosts) reset_hosts; exit 0;;
        -h | --help) usage; exit 0 ;;
        -r | --refresh) pulumi_refresh; ;;
        -p | --preview) pulumi_preview; exit 0 ;;
        -a | --apply) apply; exit 0 ;;
        -c | --configure-instance) run_playbook; ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

usage