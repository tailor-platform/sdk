# Deploy

Generate the staging workflow:

```bash
tailor setup branch --name my-app-stg --branch main
```

Generate the production workflow (the tag guard keeps its `--branch`):

```bash
tailor setup tag --name my-app-prod --branch main
```
