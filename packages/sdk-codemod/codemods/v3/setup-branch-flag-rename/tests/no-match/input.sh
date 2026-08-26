tailor setup tag --name my-app-prod --branch main
tailor setup preview --name my-app --branch main --region us-west
tailor setup coordinate --name deploy-all --action a --branch main
other-cli setup branch --branch main
custom-tailor setup branch --branch main
tailor setup branch --name my-app; tailor setup tag --branch main
echo "pass --branch to setup tag"
