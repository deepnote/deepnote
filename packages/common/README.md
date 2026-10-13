# @deepnote/common

Private helpers shared by several `@deepnote/*` packages. It is never published.

## Usage

Add it to the importing package's `devDependencies`. It is inlined into that package's `dist` at build time:

```json
{
  "devDependencies": {
    "@deepnote/common": "workspace:*"
  }
}
```

Never list it under `dependencies`, `peerDependencies` or `optionalDependencies`; `private-packages.test.ts` fails when a package does. Do not expose its types in a package's public API.

## API

| Export                                     | Description                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `mapWithConcurrency(items, limit, worker)` | Run `worker` over `items` with at most `limit` in flight; results keep input order. |
