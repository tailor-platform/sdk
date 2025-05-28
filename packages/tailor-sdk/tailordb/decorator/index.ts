import "reflect-metadata";
import {
    TailorDBType as TDB,
    TailorDBType_ValidateConfig,
    TailorDBType_FieldConfig,
    TailorDBType_Value,
    TailorDBType_FieldHook,
    Script,
} from "@tailor-inc/operator-client";

import {
    Type,
    TypeField,
    GraphQLType,
    arrayElementTypesMap,
} from "../../schema-generator"

type TailorDBType = 'uuid' | 'string' | 'bool' | 'integer' | 'float' | 'enum' | 'datetime';

const typeMapping: Record<string, TailorDBType> = {
    'string': 'string',
    'String': 'string',
    'Number': 'integer',
    'number': 'integer',
    'Boolean': 'bool',
    'boolean': 'bool',
};

const typeMappingArray: Record<TailorDBType, GraphQLType> = {
    'string': 'String',
    'integer': 'Int',
    'float': 'Float',
    'bool': 'Boolean',
    'uuid': 'ID',
    'datetime': 'DateTime',
    'enum': 'enum',
}

interface TailorDBTypeMetadata {
    name: string;
    fields: TailorDBFieldMetadata[];
}

interface AlloewdValue {
    name: string;
    value: string;
}

type TailorDBFieldMetadata = {
    name?: string;
    description?: string;
    type?: TailorDBType;
    required?: boolean;
    allowdValues?: AlloewdValue[];
    array?: boolean;
    index?: boolean;
    unique?: boolean;
    vector?: boolean;
    foreignKey?: boolean;
    validate?: Function[];
    hooks?: {
        create?: Function,
        update?: Function,
    };
}

type TailorDBTypeConfig = {
    withTimestamps?: boolean;
}

const tailorDBTypeRegistry = new Map<Function, TailorDBTypeMetadata>();

export function TailorDBType(config?: TailorDBTypeConfig) {
    return function (target: any) {
        let metadata = tailorDBTypeRegistry.get(target);
        if (!metadata) {
            metadata = {
                name: target.name,
                fields: []
            };
        }

        if (config?.withTimestamps) {
            metadata.fields.push({
                name: 'createdAt',
                type: 'datetime',
                required: false,
                hooks: {
                    create: () => {
                        return new Date().toISOString();
                    }
                }

            });
            metadata.fields.push({
                name: 'updatedAt',
                type: 'datetime',
                required: false,
                hooks: {
                    update: () => {
                        return new Date().toISOString();
                    }
                }
            });
        }
        Type()(target);
        tailorDBTypeRegistry.set(target, metadata);
    }
}


export function TailorDBField(config?: TailorDBFieldMetadata) {
    return function (target: any, propertyKey: string) {
        let metadata = tailorDBTypeRegistry.get(target.constructor);
        if (!metadata) {
            metadata = {
                name: target.constructor.name,
                fields: []
            };
            tailorDBTypeRegistry.set(target.constructor, metadata);
        }
        const designType = Reflect.getMetadata("design:type", target, propertyKey);
        let typeName: TailorDBType = config?.type || typeMapping[designType?.name] || undefined;

        const fieldMetadata: TailorDBFieldMetadata = {
            ...config,
            name: propertyKey.toString(),
            type: typeName,
        };
        TypeField({
            type: typeMappingArray[typeName],
            nullable: !config?.required,
        })(target, propertyKey);
        metadata.fields.push(fieldMetadata);
    }
}

export function getTailorDBTypeMetadata(target: Function): TDB {
    const metadata = tailorDBTypeRegistry.get(target);
    if (!metadata) {
        throw new Error(`Type ${target} is not registered with @Type or @InputType decorator`);
    }

    const fields: Record<string, TailorDBType_FieldConfig> = {};
    metadata.fields.forEach((field) => {
        const item = arrayElementTypesMap.get(`${target.name}.${field.name}`)
        fields[field!.name!] = new TailorDBType_FieldConfig({
            type: item ? item.name : field.type,
            description: "",
            required: !!field.required,
            array: !!field.array,
            index: !!field.index,
            unique: !!field.unique,
            vector: !!field.vector,
            foreignKey: !!field.foreignKey,
            validate: field?.validate?.map((v) => {
                return new TailorDBType_ValidateConfig({
                    script: new Script({
                        expr: v.toString().trim(),
                    }),
                });
            }) || [],
            allowedValues: field.allowdValues?.map((value) => new TailorDBType_Value({
                description: value.name,
                value: value.value
            })) || [],
            hooks: new TailorDBType_FieldHook({
                create: field.hooks?.create ? new Script({
                    expr: field.hooks.create.toString().trim(),
                }) : undefined,
                update: field.hooks?.update ? new Script({
                    expr: field.hooks?.update.toString().trim(),
                }) : undefined,
            }),
        });
    });

    const tailorDb = new TDB({
        name: metadata.name,
        schema: {
            description: `${metadata.name} generated @ ${new Date().toISOString()}`,
            extends: false,
            fields,
        },
    });


    return tailorDb;
}


