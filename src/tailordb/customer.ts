import { 
  TypeField,
  TailorDBType,
  TailorDBField,
} from '@tailor-platform/tailor-sdk';

@TailorDBType({withTimestamps:true})
export class Customer {
  @TypeField({type:"uuid"})
  public id?: string;
  @TailorDBField()
  public name!: string;
  @TailorDBField()
  public email!: string;
  @TailorDBField()
  public phone?: string;
  @TailorDBField()
  public address?: string;
  @TailorDBField()
  public city?: string;
  @TailorDBField()
  public state?: string;
  @TailorDBField()
  public country?: string;
  @TailorDBField()
  public postalCode?: string;
}