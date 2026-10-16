# HTTPS

Konto has no certificate management of its own. Pick one of these setups; the examples use [Tailscale](https://tailscale.com/), whose certificates are valid and renewed automatically, but any TLS reverse proxy works.

1. **`tailscale serve` on the host** (recommended with Docker). With the default `docker-compose.yml`:

   ```bash
   tailscale serve --bg --https=8443 http://127.0.0.1:3000
   ```

   The app is then at `https://<machine>.<your-tailnet>.ts.net:8443`. Any HTTPS port works, so several apps can share one machine (`--https=8444` for the next one, and so on); `tailscale serve status` lists them. For a manual install, set `HOST=127.0.0.1` and `TRUST_PROXY=loopback` in `backend/.env` and point `tailscale serve` to the app's port.

2. **Tailscale in a sidecar container**, nothing to install on the host. [`docker-compose.tailscale.yml`](../docker-compose.tailscale.yml) runs the official Tailscale image next to the app, which becomes its own machine on your tailnet, at `https://konto.<your-tailnet>.ts.net`:

   ```bash
   mkdir -p data tailscale-state
   TS_AUTHKEY=tskey-auth-... docker compose -f docker-compose.tailscale.yml up -d --build
   ```

   Set `TS_HOSTNAME` the same way to use another machine name. The auth key (Tailscale admin console → Settings → Keys) is only needed for the first login: the machine identity is then kept in `./tailscale-state`. HTTPS certificates must be enabled for the tailnet (admin console → DNS). The serve configuration is [`docker/tailscale-serve.json`](../docker/tailscale-serve.json); only the HTTPS port is reachable from the tailnet. The sidecar runs as root, so resetting its identity takes `sudo rm -rf tailscale-state`.

3. **Certificate files served by Konto itself.** Get them with `tailscale cert <machine>.<your-tailnet>.ts.net` (or from any CA) and set `SSL_CERT_PATH` / `SSL_KEY_PATH`: in production the server then speaks HTTPS on its port. With Docker, mount the files in the container (e.g. `- /etc/konto/certs:/certs:ro` under `volumes`, with `SSL_CERT_PATH=/certs/<name>.crt`) and publish the port as you need. Certificates from `tailscale cert` expire after 90 days and must be renewed by you, which is why options 1 and 2 are preferred.

Behind any other reverse proxy that terminates TLS (nginx, Caddy...), set `TRUST_PROXY` so that secure cookies and client IPs work.
