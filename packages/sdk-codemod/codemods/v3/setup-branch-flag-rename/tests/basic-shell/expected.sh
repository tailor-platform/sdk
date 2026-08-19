#!/bin/sh
tailor setup branch --name my-app-stg --target main
tailor setup branch --target release --environment staging
pnpm exec tailor setup branch --name my-app --target main
tailor setup tag --name my-app-prod --branch main --environment production
tailor setup preview --name my-app --branch main --region us-west
tailor setup coordinate --name deploy-all --action a,b --branch main
