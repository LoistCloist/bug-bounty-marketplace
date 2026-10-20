# @bbm/web

Next.js frontend. API calls go to `/api/*`, which `src/proxy.ts` forwards to
`API_INTERNAL_URL` when it is set (read per request). With
`NEXT_PUBLIC_API_MOCKING=enabled`, MSW mocks the API in the browser instead.

## Container image

`apps/web/Dockerfile` builds the `output: "standalone"` server. Build it from
the repo root with BuildKit (it uses a cache mount for the pnpm store):

```sh
docker build -f apps/web/Dockerfile -t bbm-web .
docker run -p 3000:3000 -e API_INTERNAL_URL=http://api:3001 bbm-web
```

- `NEXT_PUBLIC_API_MOCKING` is a build arg (default `disabled`). Next inlines
  it into the client bundle, so changing it means rebuilding the image
  (`--build-arg NEXT_PUBLIC_API_MOCKING=enabled`).
- `API_INTERNAL_URL` is a runtime env var, so one image can target any API.
- The server runs as `node` with `node apps/web/server.js` from `/app`, on
  `HOSTNAME=0.0.0.0` and `PORT=3000`. The healthcheck calls `GET /healthz`.
