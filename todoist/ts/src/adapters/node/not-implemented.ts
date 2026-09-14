// A stub that fails honestly.
//
// Phase B fixes the SHAPE of the Node side so Phase F fills in blanks rather
// than redesigning the seam. Everything not yet written throws this rather than
// returning a plausible empty value — a TableStore that quietly returned no
// rows would make a pipeline compute a full rebuild from nothing and then try
// to write it.

export function notImplemented(what: string, plannedFor: string): never {
	throw new Error(
		`${what} is not implemented for Node yet (planned for ${plannedFor}). ` +
			`The port runs on Apps Script today; this exists so the shape is ` +
			`settled and Phase F is filling blanks rather than redesigning.`,
	);
}
