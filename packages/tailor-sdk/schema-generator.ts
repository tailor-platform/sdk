import 'reflect-metadata';
import { GraphQLType, scalarTypes, SDLTypeMetadata } from './types/types';

// Store array element types for later reference
export const arrayElementTypesMap = new Map<string, Function>();

const typeRegistry = new Map<Function, SDLTypeMetadata>();

/**
 * Generates GraphQL SDL for all registered types
 */
export function generateSDL(metadataList: SDLTypeMetadata[] = []): string {
  let sdl = "";

  metadataList.forEach((metadata) => {
    sdl += generateSDLFromMetadata(metadata);
  });
  for (const [_, metadata] of typeRegistry) {
    sdl += generateSDLFromMetadata(metadata);
  }

  return sdl;
}

export function generateSDLFromMetadata(metadata: SDLTypeMetadata): string {
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
  const typesToInclude = new Map<Function, SDLTypeMetadata>();
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
