tailor setup branch --branch $(repo-info --branch current)
tailor setup branch --name $(get-name) --branch main
tailor setup branch --branch main > >(log-tool --branch deployment)
tailor setup branch --branch main # setup tag keeps --branch main
