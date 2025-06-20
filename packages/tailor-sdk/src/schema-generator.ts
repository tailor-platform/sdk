/* eslint-disable @typescript-eslint/no-unsafe-function-type */

import { SDLTypeMetadata } from "./types/types";
import { measure } from "./performance";

// Store array element types for later reference
export const arrayElementTypesMap = new Map<string, Function>();

const typeRegistry = new Map<Function, SDLTypeMetadata>();

export class SchemaGenerator {
  /**
   * Generates GraphQL SDL for all registered types
   */
  @measure
  static generateSDL(metadataList: SDLTypeMetadata[] = []): string {
    const sdl = [];

    metadataList.forEach((metadata) => {
      sdl.push(this.generateSDLFromMetadata(metadata));
    });
    for (const [_, metadata] of typeRegistry) {
      sdl.push(this.generateSDLFromMetadata(metadata));
    }

    return sdl.join("\n");
  }

  @measure
  static generateSDLFromMetadata(metadata: SDLTypeMetadata): string {
    const typeName = metadata.isInput ? "input" : "type";
    const sdl = [`${typeName} ${metadata.name} {`];

    for (const field of metadata.fields) {
      let fieldType = field.type;

      // Handle list types
      if (field.array) {
        fieldType = `[${field.type || "JSON"}]`;
      }

      // Handle non-nullable types
      if (field.required) {
        fieldType += "!";
      }

      sdl.push(`  ${field.name}: ${fieldType}`);
    }

    sdl.push("}");

    return `${sdl.join("\n")}\n`;
  }
}
