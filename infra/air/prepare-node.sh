#!/bin/sh
# On a dedicated Ubuntu Air VM. Caller supplies the role and local image from
# the same git revision on all nodes. eth0 carries OOB SSH.
set -eu
role=${1:?hub or agent-a/b/c}
image=${2:?loaded Docker image}
case "$role" in hub) host=10;; agent-a) host=11;; agent-b) host=12;; agent-c) host=13;; *) exit 2;; esac
ip link show eth1 >/dev/null
if ip -4 route show default | grep -qw eth1; then echo 'eth1 is the management/default route' >&2; exit 1; fi
ip link set eth1 up
ip address replace "10.76.4.$host/24" dev eth1
docker volume create meetmesh-state >/dev/null
docker run --name meetmesh-node --init --detach --network host \
  --cap-add NET_ADMIN --add-host hub-data:10.76.4.10 --add-host agent-a:10.76.4.11 \
  -e MEETMESH_DATA_HOST=hub-data --volume meetmesh-state:/state "$image"
