# src/assets

Content-addressed asset resolver. Large files never travel through Nostr relays; scenes and tokens
carry an `AssetRef` (sha256, kind, mime, size, `sources[]`) and each client fetches and verifies the
bytes itself.

```ts
const assets = createAssetResolver({ libraryBase: `${import.meta.env.BASE_URL}library` })
const url = await assets.resolve(ref) // blob: URL, safe to hand to three.js / <audio> / <img>
assets.release(ref)                   // when done
```

## Source order

`resolve(ref)` stops at the first source that yields bytes whose SHA-256 equals `ref.sha256`:

1. In-memory object URL (same hash resolved before; reference counted).
2. IndexedDB cache (re-hashed on read; a corrupt entry is skipped).
3. Starter library: if `library/index.json` lists the hash, fetch `<libraryBase>/<path>`.
4. Each URL in `ref.sources`, in order.
5. `DEFAULT_BLOSSOM_SERVERS` (or `blossomServers` option) as `<server>/<sha256>`.

A source that errors or returns the wrong bytes is skipped and the next is tried; if all fail, the
error lists every attempt. Verified downloads are written to the cache. Concurrent `resolve` calls for
one hash share a single download. `release` decrements a per-hash count and revokes the object URL
when the last holder lets go. `onProgress(ref, loaded, total)` fires while downloading.

The cache can be inspected and trimmed: `stats()` returns `{ count, bytes }`, `evict(maxBytes)`
deletes least-recently-used blobs until the cache fits. Cache failures (private mode, quota) never
break resolving; the network path still works.

## Library index

`public/library/index.json` is a list of `{ sha256, path, kind, mime, size, name, license }`. It is
generated, never hand-edited: put CC0 files under `public/library/` and run

```
npm run library:index
```

which hashes everything except `index.json`, `*.md`, `license.txt` and dotfiles. A `license.txt`
(first line, SPDX id) in a folder overrides the default `CC0-1.0` for files under it. Commit the
regenerated index with the files. `placeholder.json` is a stand-in until real assets land.

## How a GM shares a file

1. `importFile(file)` hashes the file, stores it locally and returns an `AssetRef` with no sources.
   Place the ref in the scene or token; players on the same machine already resolve it.
2. For other players the bytes need a source. Either:
   - `uploadToBlossom(ref, server, signer)`: signs a kind 24242 auth event (BUD-02: `t=upload`,
     `x=<sha256>`, `expiration`), `PUT <server>/upload` with `Authorization: Nostr <base64 event>`,
     and returns the ref with the descriptor URL appended to `sources`. `signer` receives the
     unsigned event and returns the signed one (NIP-07 `signEvent` or a local key).
   - Host the file anywhere public and call `addUrlSource(ref, url)`, which downloads it, checks the
     hash, and appends the URL only if it matches.
3. Publish the updated ref in the game doc. Players resolve it through the order above; anything
   served with wrong bytes is rejected.

Blossom errors from the server (401/403 auth, 402 payment, 413 size, 415 type) are surfaced with the
server's `X-Reason` text where present.
