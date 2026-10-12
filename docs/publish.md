# Publish a new release

How to ship a new version of `socialcalc-mcp` to **npm** and **GitHub Packages**.

| Registry | Package name | Published by |
| :--- | :--- | :--- |
| npm | `socialcalc-mcp` | The `npm` job in [`publish.yml`](../.github/workflows/publish.yml), using the `NPM_TOKEN` secret |
| GitHub Packages | `@aspiringsdgs/socialcalc-mcp` | The `github-packages` job, using the built-in `GITHUB_TOKEN` |

Publishing to GitHub Packages is what makes the package show up in the repository's **Packages** sidebar. GitHub only lists packages from its own registry there, never from npmjs.com, and it requires the scope to match the owning organisation. The workflow adds that scope at publish time, so the name on npm stays `socialcalc-mcp`.

## One-time setup

1. **Add the npm token.** Create a granular access token on npmjs.com with read and write access to `socialcalc-mcp`, then store it:

   ```bash
   gh secret set NPM_TOKEN -R aspiringsdgs/socialcalc-mcp
   ```

   The npm account that owns the token must be a maintainer of `socialcalc-mcp`. If your npm account uses two-factor authentication for publishing, use an automation or granular token that bypasses it.

2. **Check Actions permissions.** In the repository settings under Actions, workflows must be allowed to run. The workflow requests `packages: write` itself, so the default read-only token setting is fine.

The GitHub Packages job needs no secret.

## Release steps

Run these from an up-to-date `main` branch.

1. **Make sure it builds.**

   ```bash
   npm ci
   npm run build
   npm pack --dry-run      # lists exactly what will be published
   ```

2. **Bump the version.** This updates `package.json` and `package-lock.json`, commits, and creates a `v<version>` tag, matching the existing `v1.0.4`, `v1.0.5`, `v1.0.6` tags.

   ```bash
   npm version patch       # or minor / major
   ```

3. **Push the commit and tag.**

   ```bash
   git push --follow-tags
   ```

4. **Create the GitHub Release.** Publishing the release is what triggers the workflow.

   ```bash
   gh release create v1.0.7 --generate-notes
   ```

   Replace `v1.0.7` with the tag from step 2. You can also do this in the GitHub UI under Releases.

5. **Watch the workflow.**

   ```bash
   gh run watch -R aspiringsdgs/socialcalc-mcp
   ```

6. **Verify.**

   ```bash
   npm view socialcalc-mcp version        # the new version
   npx -y socialcalc-mcp@latest           # starts and waits on stdin; Ctrl+C to stop
   ```

   The package page is `https://github.com/aspiringsdgs/socialcalc-mcp/pkgs/npm/socialcalc-mcp`.

## What the workflow checks

- The release tag must equal `v` plus the `version` in `package.json`. A mismatch fails the job before anything is published.
- `npm ci` installs from the lockfile, `npm run build` compiles `dist/`, then `npm publish` runs. The build must happen **before** `npm publish`: npm removes the `bin` entry from the published metadata when `dist/index.js` does not exist yet, which would break `npx`. The package ships only `dist/` (see `files` in `package.json`).

## Publishing to one registry only

Open the repository's **Actions** tab, choose **Publish**, then **Run workflow**, and select `github`, `npm` or `both`. Or from the terminal:

```bash
gh workflow run publish.yml -R aspiringsdgs/socialcalc-mcp -f registry=github
```

A manual run publishes whatever version is in `package.json` on the branch you select.

## Publishing by hand

Only needed if Actions is unavailable.

**npm**

```bash
npm login
npm publish --access public
```

**GitHub Packages** needs a personal access token (classic) with `write:packages`:

```bash
npm login --scope=@aspiringsdgs --registry=https://npm.pkg.github.com
npm pkg set name=@aspiringsdgs/socialcalc-mcp
npm publish --registry=https://npm.pkg.github.com
git checkout package.json          # undo the temporary rename
```

## Things to know

- **A version can be published only once** on each registry. If a publish fails halfway, bump the version rather than retrying the same one.
- **npm metadata comes from the published `package.json`.** The `repository`, `bugs` and `homepage` links shown on npmjs.com only change when a new version is published.
- **Do not edit `name` in `package.json`** to add the scope. The workflow does it on the fly so that npm keeps the unscoped name.
- To retract a bad npm release within 72 hours, use `npm unpublish socialcalc-mcp@<version>`, or prefer `npm deprecate socialcalc-mcp@<version> "reason"`, which does not break installs.

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| `The NPM_TOKEN repository secret is not set` | Add the secret as described in one-time setup |
| `E403 ... cannot publish over the previously published versions` | That version already exists. Bump and publish again |
| `E401` or `E404` on the GitHub Packages job | Confirm the job has `packages: write` and that `repository.url` in `package.json` points to this repository |
| Release tag does not match package.json version | Delete the release and tag, run `npm version`, push, and create the release again |
| Package is not in the repository sidebar | It appears after the first successful GitHub Packages publish. Check the org's packages page and that the package is linked to this repository |
