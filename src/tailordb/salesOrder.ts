import {
    TailorDBField,
    TailorDBType,
    TypeField,
} from "@tailor-platform/tailor-sdk";

@TailorDBType()
export class SalesOrder {
    @TypeField({ type: "uuid" })
    public id?: string;

    @TailorDBField({ type: "uuid" })
    public cutomerID?: string;

    @TailorDBField()
    public totalPrice?: number;

    @TailorDBField()
    public discount?: number;

    @TailorDBField()
    public status?: string;

    @TailorDBField()
    public cancelReason?: number;

    @TailorDBField()
    public canceledAt?: string;

    @TailorDBField()
    public createdAt?: string;

    @TailorDBField()
    public updatedAt?: string;
}
