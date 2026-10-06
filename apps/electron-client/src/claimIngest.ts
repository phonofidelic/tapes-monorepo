import {
  checkRecordingClaim,
  createHostReceipt,
  decodeSignedStatement,
  encodeSignedStatement,
  type ClaimVerification,
} from '@tapes-monorepo/provenance'

/**
 * Checks the claim that came with an upload and, if it holds, signs a host
 * receipt for it. Shared by the `/blobs` upload route and the electron
 * recorder's file ingest.
 *
 * A failed check never fails the upload. The audio is kept and reported as
 * unverified. Rejecting it would lose the take, and a hash mismatch would fail
 * the same way on every retry.
 *
 * Do not import `electron` here. The sync server uses this module, and it
 * stays testable in a plain node process.
 */
export async function verifyClaimOnIngest(
  encodedClaim: string | undefined,
  received: { hash: string; size: number },
  loadSigningKey: (() => Promise<CryptoKeyPair>) | undefined,
): Promise<ClaimVerification> {
  // Read the clock before any async work, so the receipt says when the bytes
  // arrived rather than when signing finished.
  const receivedAt = new Date()
  if (encodedClaim === undefined) {
    return { status: 'unsigned' }
  }

  const signed = decodeSignedStatement(encodedClaim)
  const check = signed
    ? await checkRecordingClaim(signed, received)
    : ({ ok: false, problem: 'malformed' } as const)
  if (!check.ok) {
    console.warn(
      `Recording ${received.hash} stored with an unverified claim: ` +
        check.problem,
    )
    return { status: 'unverified', problem: check.problem }
  }

  // The claim stands on its own without a receipt, so a missing host key
  // leaves it verified but uncountersigned.
  if (!loadSigningKey) {
    return { status: 'verified' }
  }
  try {
    const receipt = await createHostReceipt(
      check.claim,
      await loadSigningKey(),
      receivedAt,
    )
    return { status: 'verified', receipt: encodeSignedStatement(receipt) }
  } catch (error) {
    console.warn(
      'Verified a recording claim but could not sign a receipt:',
      error,
    )
    return { status: 'verified' }
  }
}
