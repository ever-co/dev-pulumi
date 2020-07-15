FROM jenkins/jenkins:lts

LABEL maintainer="Ismayil Mirzali"

USER root

ENV DOCKERVERSION=19.03.12-ce

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg-agent \
    software-properties-common && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | apt-key add - && \
    add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/debian $(lsb_release -cs) stable" && \
    apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io && \
    rm -rfd /var/lib/apt/lists/* && usermod -aG docker jenkins

USER jenkins