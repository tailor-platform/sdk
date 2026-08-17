tailor setup branch --target $(repo-info --branch current)
tailor setup branch --name $(get-name) --branch main
tailor setup branch --target main > >(log-tool --branch deployment)
tailor setup branch --target main # setup tag keeps --branch main
