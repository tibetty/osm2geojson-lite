In order to release a new version to NPM do the following steps:

1. Use the Create bump version PR action to create a PR to update the version
3. Update [changelog](./CHANGELOG.md) with the relevant changes
4. Merge the PR

The release CI will kick in, create a git tag, a github release and publish the package to NPM.
