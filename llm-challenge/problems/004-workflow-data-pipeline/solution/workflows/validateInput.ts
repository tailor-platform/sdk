import { createWorkflowJob } from "@tailor-platform/sdk";

type ValidateInputInput = {
  email: string;
  amount: number;
  items: { name: string; price: number }[];
};

type ValidateInputOutput = {
  valid: boolean;
  errors: string[];
};

export const validateInput = createWorkflowJob({
  name: "validate-input",
  body: (input: ValidateInputInput): ValidateInputOutput => {
    const errors: string[] = [];

    if (!input.email.includes("@")) {
      errors.push("Invalid email: must contain @");
    }

    if (input.amount <= 0) {
      errors.push("Invalid amount: must be greater than 0");
    }

    if (input.items.length === 0) {
      errors.push("Invalid items: must not be empty");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
});
