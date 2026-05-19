'use client';

type CollectionReference = any;
type DocumentReference = any;
type SetOptions = any;

/**
 * No-op compatibility helper retained so older callers can import it safely.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options: SetOptions) {
  void docRef;
  void data;
  void options;
}

/**
 * No-op compatibility helper retained so older callers can import it safely.
 */
export function addDocumentNonBlocking(colRef: CollectionReference, data: any) {
  void colRef;
  void data;
  return Promise.resolve(null);
}

/**
 * No-op compatibility helper retained so older callers can import it safely.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  void docRef;
  void data;
}

/**
 * No-op compatibility helper retained so older callers can import it safely.
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  void docRef;
}
