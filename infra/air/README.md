# Air lab

The Air check still requires an assigned NVIDIA simulation with four reachable Linux VMs. The local Docker measurements have separate evidence in `docs/evidence/m4/`.

1. Import `topology.dot` with OOB management enabled. Put switch ports swp1 through swp4 on the same access VLAN. Confirm your quota covers one switch and four VMs, the topology image IDs are available, and each VM has Docker and the `eth0` management and `eth1` data interfaces. Keep the export from the running simulation with the verification records. [Topology import](https://docs.nvidia.com/dsx-air/custom-topology/) · [OOB management](https://docs.nvidia.com/dsx-air/oob-management-network/)
2. Create local OpenSSH aliases for the four management connections and enroll the VM host keys from a trusted source. The launcher uses batch SSH, strict host-key checking and `sudo -n`. The operator needs Docker and the permitted network configuration commands on each disposable lab VM. Use different aliases for the four VMs.
3. From a clean checkout, make an inventory under `.state/air/` using `inventory.example.json`. Use the exact Git SHA being packaged and a dedicated lab name.
4. Create a single image archive on the build machine. Choose the platform that matches the VMs.

   ```sh
   mkdir -p .state/air
   revision=$(git rev-parse HEAD)
   docker buildx build --platform linux/amd64 --load \
     --label "org.opencontainers.image.revision=$revision" \
     -f infra/network/Dockerfile -t meetmesh-m4:air .
   docker pull --platform linux/amd64 postgres:16-alpine
   docker image save --output .state/air/images.tar meetmesh-m4:air postgres:16-alpine
   ```

5. Run the deployment and checks from repository root. Without `--apply`, the launcher prints the selected action and exits before connecting to the VMs. Inspect prints Linux, Docker and data interface information. Deploy transfers and loads the image archive, brings up the application containers, prepares a loopback PostgreSQL instance on the hub VM and provisions the lab agents.

   ```sh
   node infra/air/lab.mjs inspect --inventory .state/air/inventory.json --apply
   node infra/air/lab.mjs deploy --inventory .state/air/inventory.json --archive .state/air/images.tar --apply
   node infra/air/lab.mjs verify --inventory .state/air/inventory.json --apply
   ```

   If the images already exist on the correct nodes, omit `--archive` from deployment. Each application image must carry the source revision label. The launcher refuses to reuse an app container with a different image or role. For a new image, remove the previous lab application containers explicitly, keeping their named state volumes, and deploy again. Retain the local `.state/air/<lab>/credentials.json` and CA for repeat deployments of the same lab. Protect that directory as you would a private key.

Verification starts the hub and the three agents for each scenario and collects their JSON application logs over OOB SSH. It asserts the WSS routes use eth1 and first confirms a normal three-agent meeting. In the next run it cuts C's data egress, checks that TLS health fails while management commands still answer, removes the impairment and checks that the meeting converges to one calendar record per agent. It writes image IDs, versions, qdisc counters and outcome data under `.state/evidence/air/<lab>/`. The verification shuts down the application processes, leaving containers and persistent stores prepared for repeat runs. It uses NetEm only if C starts with `noqueue`. With a different queue discipline it brings eth1 down briefly and records `link-down` as the cut method, leaving NetEm verification pending. If the operator loses SSH during a cut, restore eth1 on C or remove the lab-owned `4d4d:` queue, as applicable.

The data subnet is 10.76.4.0/24. Only the hub can access the lab PostgreSQL service, which binds to its loopback port 55436. The launcher checks the management route before assigning data addresses and refuses to replace an unrecognized queue discipline. Confirm the Air export and summary before treating the run as Air evidence. If the topology or privileges are unavailable, publish the observed blocker and use the [local Linux procedure](../network/README.md) separately.
