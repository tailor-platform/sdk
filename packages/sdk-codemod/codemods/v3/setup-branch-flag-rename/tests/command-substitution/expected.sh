tailor setup branch --trigger-branch $(repo-info --branch current)
tailor setup branch --name $(get-name) --branch main
tailor setup branch --trigger-branch main > >(log-tool --branch deployment)
tailor setup branch --trigger-branch main # setup tag keeps --branch main
