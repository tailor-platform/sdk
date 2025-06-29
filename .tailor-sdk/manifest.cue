{
  "Kind": "pipeline",
  "Description": "",
  "Namespace": "default",
  "Resolvers": [
    {
      "Authorization": "true==true",
      "Description": "stepChain resolver",
      "Inputs": [
        {
          "Name": "input",
          "Description": "",
          "Array": false,
          "Required": true,
          "Type": {
            "Kind": "UserDefined",
            "Name": "StepChainInput",
            "Description": "",
            "Required": false,
            "Fields": [
              {
                "Name": "name",
                "Description": "",
                "Type": {
                  "Kind": "ScalarType",
                  "Name": "String",
                  "Description": "",
                  "Required": false
                },
                "Array": false,
                "Required": true
              }
            ]
          }
        }
      ],
      "Name": "stepChain",
      "Response": {
        "Type": {
          "Kind": "UserDefined",
          "Name": "StepChainOutput",
          "Description": "",
          "Required": true,
          "Fields": [
            {
              "Name": "summary",
              "Description": "",
              "Type": {
                "Kind": "ScalarType",
                "Name": "String",
                "Description": "",
                "Required": false
              },
              "Array": true,
              "Required": true
            }
          ]
        },
        "Description": "",
        "Array": false,
        "Required": true
      },
      "Pipelines": [
        {
          "Name": "step1",
          "OperationName": "step1",
          "Description": "step1",
          "OperationType": 2,
          "OperationSourcePath": ".tailor-sdk/functions/stepChain__step1.js",
          "OperationHook": {
            "Expr": "({ ...context.pipeline, ...context.args });"
          },
          "PostScript": "args.step1"
        },
        {
          "Name": "step2",
          "OperationName": "step2",
          "Description": "step2",
          "OperationType": 2,
          "OperationSourcePath": ".tailor-sdk/functions/stepChain__step2.js",
          "OperationHook": {
            "Expr": "({ ...context.pipeline, ...context.args });"
          },
          "PostScript": "args.step2"
        },
        {
          "Name": "sqlStep",
          "OperationName": "sqlStep",
          "Description": "sqlStep",
          "OperationType": 2,
          "OperationSourcePath": ".tailor-sdk/functions/stepChain__sqlStep.js",
          "OperationHook": {
            "Expr": "({ ...context.pipeline, ...context.args });"
          },
          "PostScript": "args.sqlStep"
        },
        {
          "Name": "kyselyStep",
          "OperationName": "kyselyStep",
          "Description": "kyselyStep",
          "OperationType": 2,
          "OperationSourcePath": ".tailor-sdk/functions/stepChain__kyselyStep.js",
          "OperationHook": {
            "Expr": "({ ...context.pipeline, ...context.args });"
          },
          "PostScript": "args.kyselyStep"
        },
        {
          "Name": "__construct_output",
          "OperationName": "__construct_output",
          "Description": "Construct output from resolver",
          "OperationType": 2,
          "OperationSource": "globalThis.main = context=>({summary:[context.step1,context.step2,context.sqlStep,context.kyselyStep]})",
          "OperationHook": {
            "Expr": "({ ...context.pipeline, ...context.args });"
          },
          "PostScript": "args.__construct_output"
        }
      ],
      "PostHook": {
        "Expr": "({ ...context.pipeline.__construct_output });"
      },
      "PublishExecutionEvents": false
    }
  ],
  "Version": "v2"
}