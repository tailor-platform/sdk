import 'reflect-metadata';
import { GraphQLType, scalarTypes, TypeMetadata } from './types';

// Store array element types for later reference
export const arrayElementTypesMap = new Map<string, Function>();

const typeRegistry = new Map<Function, TypeMetadata>();

/**
 * Maps TypeScript types to GraphQL types
 */
const typeMapping: Record<string, GraphQLType> = {
  'uuid': 'ID',
  'string': 'String',
  'number': 'Int',
  "int": 'Int',
  "float": 'Float',
  'boolean': 'Boolean',
  'date': 'Date',
  'time': 'Time',
  'datetime': 'DateTime',
  'object': 'JSON',
  'array': 'JSON',
};

function toGraphQLType(type: string): GraphQLType {
  const typeStr = type.toLowerCase();
  if (typeMapping.hasOwnProperty(typeStr)) {
    return typeMapping[typeStr];
  }
  return typeStr;
}

/**
 * Decorator for GraphQL Input Types
 */
export function InputType() {
  return function (target: Function) {
    let metadata = typeRegistry.get(target);
    if (!metadata) {
      metadata = {
        name: target.name,
        fields: [],
        isInput: true
      };
      typeRegistry.set(target, metadata);
    } else {
      metadata.isInput = true; // Update existing metadata to mark as input type
      typeRegistry.set(target, metadata);
    }
  };
}

/**
 * Decorator for GraphQL Object Types
 */
export function Type() {
  return function (target: Function) {
    let metadata = typeRegistry.get(target);
    if (!metadata) {
      metadata = {
        name: target.name,
        fields: [],
        isInput: false
      };
      typeRegistry.set(target, metadata);
    } else {
      metadata.isInput = false; // Update existing metadata to mark as object type
      typeRegistry.set(target, metadata);
    }
  };
}

type TypeConfig = {
  type?: string;
  nullable?: boolean;
}
/**
 * Field decorator for both Input and Object types
 */
export function TypeField(config?: TypeConfig) {
  return function (target: any, propertyKey: string) {
    registerField(target, propertyKey, config);
  }
}

/**
 * Field decorator specifically for Input types
 */
export function InputTypeField(config?: TypeConfig) {
  return function (target: any, propertyKey: string) {
    registerField(target, propertyKey, config);
  }
}

/**
 * Register the type of array elements for a field
 */
export function ArrayOf(elementType: Function) {
  return function (target: any, propertyKey: string) {
    // Store the element type for this array field
    const key = `${target.constructor.name}.${propertyKey}`;
    arrayElementTypesMap.set(key, elementType);
  };
}

/**
 * Helper function to register a field in the typeRegistry
 */
function registerField(target: any, propertyKey: string, config?: TypeConfig) {
  const constructor = target.constructor;

  // Get or create metadata for the class
  let metadata = typeRegistry.get(constructor);
  if (!metadata) {
    metadata = {
      name: constructor.name,
      fields: [],
      isInput: false // Default, will be updated by class decorator
    };
    typeRegistry.set(constructor, metadata);
  }

  // Get the type of the property using reflect-metadata
  const designType = Reflect.getMetadata("design:type", target, propertyKey);
  const typeName = config?.type || designType?.name || "undefined";

  // Clean the property name (remove the ? if present)
  const cleanPropertyKey = propertyKey.replace('?', '');

  // Check if it's an array type
  let array: boolean = typeName === 'Array' ||
    Array.isArray(target[propertyKey]) ||
    typeName.includes('Array');

  // Check for ArrayOf decorator - if it exists, mark as list
  const key = `${constructor.name}.${cleanPropertyKey}`;
  const hasArrayOfDecorator = arrayElementTypesMap.has(key);
  if (hasArrayOfDecorator) {
    array = true;
  }

  // Map the TypeScript type to GraphQL type
  let graphQLType = toGraphQLType(typeName);


  // Handle reference to other schema types
  if (typeRegistry.has(designType)) {
    graphQLType = designType.name;
  }

  // Try to determine the element type for arrays
  let elementType: GraphQLType | undefined = undefined;
  if (array) {
    // Check if the array element type was explicitly defined using @ArrayOf
    const key = `${constructor.name}.${cleanPropertyKey}`;
    const arrayElementType = arrayElementTypesMap.get(key);

    if (arrayElementType) {
      // If the element type is registered as a GraphQL type, use its name
      if (typeRegistry.has(arrayElementType)) {
        elementType = arrayElementType.name;
      } else {
        // Otherwise map it to a GraphQL type
        elementType = toGraphQLType(arrayElementType.name);
      }
    } else {
      // Try to infer element type from runtime values if available
      if (Array.isArray(target[propertyKey]) && target[propertyKey].length > 0) {
        const firstElement = target[propertyKey][0];
        if (firstElement) {
          const elementConstructor = firstElement.constructor;
          if (typeRegistry.has(elementConstructor)) {
            elementType = elementConstructor.name;
          } else {
            const typeName = elementConstructor.name;
            elementType = toGraphQLType(typeName);
          }
        }
      }
    }

    // Try to infer from property name based on common naming patterns
    if (!elementType) {
      // Common naming patterns like "items" for Item[], "products" for Product[], etc.
      const singularName = cleanPropertyKey.replace(/s$/, ''); // Remove trailing 's'
      const capitalized = singularName.charAt(0).toUpperCase() + singularName.slice(1);

      // Check if a type with the singular name exists in the registry
      for (const [registeredType, meta] of typeRegistry.entries()) {
        if (registeredType.name === capitalized) {
          elementType = capitalized;
          break;
        }
      }
    }

    // Default to a safe type if we couldn't determine the element type
    if (!elementType) {
      elementType = 'JSON';
    }
  }

  // Add the field to the metadata
  metadata.fields.push({
    name: cleanPropertyKey,
    type: elementType ?? graphQLType,
    required: !config?.nullable,
    array,
  });
}

/**
 * Generates GraphQL SDL for all registered types
 */
export function generateSDL(metadataList: TypeMetadata[] = []): string {
  let sdl = "";

  metadataList.forEach((metadata) => {
    sdl += generateSDLFromMetadata(metadata);
  });
  for (const [_, metadata] of typeRegistry) {
    sdl += generateSDLFromMetadata(metadata);
  }

  return sdl;
}

export function generateSDLFromMetadata(metadata: TypeMetadata): string {
  const typeName = metadata.isInput ? 'input' : 'type';
  let sdl = `${typeName} ${metadata.name} {\n`;

  for (const field of metadata.fields) {
    let fieldType = field.type;

    // Handle list types
    if (field.array) {
      fieldType = `[${field.type || 'JSON'}]`;
    }

    // Handle non-nullable types
    if (!!field.required) {
      fieldType += '!';
    }

    sdl += `  ${field.name}: ${fieldType}\n`;
  }

  sdl += '}\n';

  return sdl;
}

/**
 * Generate SDL for a specific class
 */
export function generateSDLForType(type: any): string {
  const metadata = typeRegistry.get(type);
  if (!metadata) {
    throw new Error(`Type ${type.name} is not registered with @Type or @InputType decorator`);
  }

  return generateSDLFromMetadata(metadata);
}

/**
 * Generate SDL for a specific class and all its dependencies
 * This includes any types referenced in fields, including array element types
 */
export function generateSDLForTypeAndDependencies(type: any): string {
  // Map to store all types we need to generate SDL for
  const typesToInclude = new Map<Function, TypeMetadata>();
  const processedTypeNames = new Set<string>();

  // Helper function to add a type and its dependencies to the map
  const addTypeWithDependencies = (typeConstructor: Function) => {
    // Check if we've already processed this type
    if (typesToInclude.has(typeConstructor)) {
      return;
    }

    // Get metadata for this type
    const metadata = typeRegistry.get(typeConstructor);
    if (!metadata) {
      return; // Skip if type is not registered
    }

    // Add this type to our map
    typesToInclude.set(typeConstructor, metadata);
    processedTypeNames.add(metadata.name);

    // Process each field to find dependencies
    for (const field of metadata.fields) {
      // Check for regular field type dependencies
      if (!scalarTypes.includes(field.type)) {
        // Look up the type by name in registry
        for (const [constructor, meta] of typeRegistry.entries()) {
          if (meta.name === field.type && !typesToInclude.has(constructor)) {
            addTypeWithDependencies(constructor);
          }
        }
      }

      // Try to infer type from field name (e.g., "customer" field might be a "Customer" type)
      const capitalizedFieldName = field.name.charAt(0).toUpperCase() + field.name.slice(1);
      if (!processedTypeNames.has(capitalizedFieldName)) {
        for (const [constructor, meta] of typeRegistry.entries()) {
          if (meta.name === capitalizedFieldName && !typesToInclude.has(constructor)) {
            // Update the field type to match the found type
            field.type = capitalizedFieldName;
            addTypeWithDependencies(constructor);
          }
        }
      }

      // Check for array element type dependencies
      if (field.array && field.type &&
        !scalarTypes.includes(field.type)) {
        // Look up the element type by name in registry
        for (const [constructor, meta] of typeRegistry.entries()) {
          if (meta.name === field.type && !typesToInclude.has(constructor)) {
            addTypeWithDependencies(constructor);
          }
        }
      }

      // Check if this field has an ArrayOf decorator
      const key = `${metadata.name}.${field.name}`;
      if (arrayElementTypesMap.has(key)) {
        const arrayElementType = arrayElementTypesMap.get(key);
        if (arrayElementType && typeRegistry.has(arrayElementType) &&
          !typesToInclude.has(arrayElementType)) {
          addTypeWithDependencies(arrayElementType);
        }
      }
    }
  };

  // Start with the root type
  addTypeWithDependencies(type);

  // Generate SDL for all collected types
  let sdl = '';
  for (const [_, metadata] of typesToInclude) {
    sdl += generateSDLFromMetadata(metadata);
  }

  return sdl.trim();
}
