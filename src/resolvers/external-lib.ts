import { 
    resolver,
    functionStep, 
    InputType, 
    InputTypeField,
    Type, 
    TypeField,
    
} from '@tailor-platform/tailor-sdk';
import { format } from 'date-fns'; 

@InputType()
class CurrentDateInput {
}

@Type()
class CurrentDateOutput {
    @TypeField()
    message?: string;
}

function currentTime(input: CurrentDateInput): CurrentDateOutput {
  return { message: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
}

const hello = resolver("currentTime", functionStep("currentTime", currentTime, CurrentDateInput, CurrentDateOutput));

export default hello;

