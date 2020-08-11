FROM jenkins/jenkins:lts

USER root

RUN /usr/local/bin/install-plugins.sh blueocean git credentials kubernetes \
    configuration-as-code ssh-credentials scm-api workflow-job pipeline-stage-view \
    github-api workflow-aggregator ssh-slaves ws-cleanup role-strategy authorize-project \
    amazon-ecr

COPY --chown=jenkins:jenkins jenkins-config.yaml /var/jenkins_home/casc/jenkins-config.yaml

ENV CASC_JENKINS_CONFIG /var/jenkins_home/casc/jenkins-config.yaml

USER jenkins