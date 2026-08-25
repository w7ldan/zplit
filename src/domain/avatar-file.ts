import {
  ReceiptFileValidationError,
  type ValidatedReceiptFile,
  validateReceiptFile,
} from "./receipt-file";

export class AvatarFileValidationError extends ReceiptFileValidationError {
  constructor(message: string) {
    super(message);
    this.name = "AvatarFileValidationError";
  }
}

export function validateAvatarFile(input: {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
}): ValidatedReceiptFile {
  try {
    return validateReceiptFile(input, "Avatar");
  } catch (error) {
    if (error instanceof ReceiptFileValidationError) throw new AvatarFileValidationError(error.message);
    throw error;
  }
}
