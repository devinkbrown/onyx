module Attribution exposing
    ( AttributionEffect(..)
    , AttributionSession
    , EnrollReply
    , ResidenceReply
    , blankSession
    , residenceRefreshMs
    , residenceTtlMs
    , staleEpochBumpMs
    , foldAccount
    , foldAddedNotice
    , foldEnrollReply
    , foldNode
    , foldPublishedNotice
    , foldResidenceReply
    , foldStaleEpoch
    , isHexChars
    , isValidLabel
    , isValidPublicHex
    , isValidSignature
    , kickAttribution
    , resetSession
    , tickRefresh
    )

{-| Account-attribution controller — Elm port of the pure state
machine in `src/lib/irc/attribution.ts` (enroll + residence proof).

The daemon half of Design-C attribution: once the server advertises
`ISUPPORT ACCOUNTRESIDENCE=<node>` AND the canonical account is
known (900), Elm enrolls the device Ed25519 key (`IDENTITY ADD`)
once per account, then publishes residence proofs (`IDENTITY
RESIDENCE`) binding {account, node, epoch, expiry}, re-signing on
node change, epoch supersede (`FAIL STALE_EPOCH`, one bounded
retry), and refresh before lapse.

Crypto (keygen, transcripts, signatures, enrolled-marker storage)
lives behind ports — this module owns validation, trigger
transitions, and staleness guards. Fail-closed throughout: no
token, no account, or any malformed reply means NOTHING is sent —
the account stays on the daemon's conservative UID path.
-}


{-| Proof lifetime: the daemon caps `expiry - now` at 1h; 50 min
leaves a 10-min skew margin. -}
residenceTtlMs : Float
residenceTtlMs =
    50 * 60 * 1000


{-| Refresh cadence: TTL >= 2x refresh, so a missed beat never
lapses the proof. -}
residenceRefreshMs : Float
residenceRefreshMs =
    20 * 60 * 1000


{-| Epoch bump on `FAIL STALE_EPOCH` (another device published ahead
of our clock); the epoch is an opaque monotonic counter. -}
staleEpochBumpMs : Float
staleEpochBumpMs =
    5 * 60 * 1000


type alias AttributionSession =
    { serverUrl : String
    , account : Maybe String
    , nodeHex : Maybe String
    , publishedNode : Maybe String
    , lastEpoch : Float
    , staleRetried : Bool
    , pendingEnroll : Maybe { account : String, label : String, publicHex : String }
    , gen : Int
    , stopped : Bool
    , refreshDueMs : Maybe Float
    }


type alias EnrollReply =
    { account : String
    , nodeHex : String
    , gen : Int
    , label : String
    , publicHex : String
    , sig : String
    , alreadyEnrolled : Bool
    }


type alias ResidenceReply =
    { account : String
    , nodeHex : String
    , epoch : Float
    , expiryMs : Float
    , gen : Int
    , sig : String
    }


type AttributionEffect
    = NoEffect
    | RequestEnroll { serverUrl : String, account : String, nodeHex : String, gen : Int }
    | RequestResidenceSign { serverUrl : String, account : String, nodeHex : String, epoch : Float, expiryMs : Float, gen : Int }
    | ConfirmEnrolled { serverUrl : String, account : String, publicHex : String }
    | SendIdentityAdd { label : String, publicHex : String, sig : String }
    | SendIdentityResidence { nodeHex : String, epoch : Float, expiryMs : Float, sig : String }


blankSession : AttributionSession
blankSession =
    { serverUrl = ""
    , account = Nothing
    , nodeHex = Nothing
    , publishedNode = Nothing
    , lastEpoch = 0
    , staleRetried = False
    , pendingEnroll = Nothing
    , gen = 0
    , stopped = False
    , refreshDueMs = Nothing
    }


{-| New connection attempt: forget per-connection state, keep the
epoch floor (mirroring `reset`). -}
resetSession : AttributionSession -> AttributionSession
resetSession session =
    { session
        | gen = session.gen + 1
        , stopped = False
        , account = Nothing
        , nodeHex = Nothing
        , publishedNode = Nothing
        , pendingEnroll = Nothing
        , staleRetried = False
        , refreshDueMs = Nothing
    }


isHexChars : Int -> String -> Bool
isHexChars len value =
    String.length value == len
        && String.all
            (\c ->
                (c >= '0' && c <= '9')
                    || (c >= 'a' && c <= 'f')
                    || (c >= 'A' && c <= 'F')
            )
            value


{-| Device enroll label: 1-32 of `[A-Za-z0-9._-]` (mirrors
`LABEL_RE`; ports mints `onyx-<pubkey16>`). -}
isValidLabel : String -> Bool
isValidLabel value =
    let
        len =
            String.length value
    in
    len >= 1
        && len <= 32
        && String.all
            (\c ->
                (c >= 'a' && c <= 'z')
                    || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9')
                    || c == '.'
                    || c == '_'
                    || c == '-'
            )
            value


isValidPublicHex : String -> Bool
isValidPublicHex value =
    isHexChars 64 value


isValidSignature : String -> Bool
isValidSignature value =
    isHexChars 128 value


{-| ISUPPORT `ACCOUNTRESIDENCE=<node>`: exactly 16 hex, else ignored
(mirrors `setNode`). -}
foldNode : AttributionSession -> String -> ( AttributionSession, AttributionEffect )
foldNode session raw =
    let
        hex =
            String.toLower raw
    in
    if not (isHexChars 16 hex) then
        ( session, NoEffect )

    else if Just hex == session.nodeHex then
        ( session, NoEffect )

    else
        kickAttribution { session | nodeHex = Just hex }


{-| 900 account observe: the 4-param form names the account; a live
transition is a full owner boundary (mirrors `observe`). -}
foldAccount : AttributionSession -> Maybe String -> ( AttributionSession, AttributionEffect )
foldAccount session account =
    case account of
        Nothing ->
            ( session, NoEffect )

        Just next ->
            if Just next == session.account then
                ( session, NoEffect )

            else
                kickAttribution
                    { session
                        | gen = session.gen + 1
                        , account = Just next
                        , publishedNode = Nothing
                        , pendingEnroll = Nothing
                        , staleRetried = False
                        , refreshDueMs = Nothing
                    }


{-| Emit the enroll request when an unsigned proof is owed
(mirrors `kick`/`run`: account + node known, nothing published for
this node, not stopped). The server URL rides along for the
owner-scoped enrolled marker. -}
kickAttribution : AttributionSession -> ( AttributionSession, AttributionEffect )
kickAttribution session =
    if session.stopped then
        ( session, NoEffect )

    else
        case ( session.account, session.nodeHex ) of
            ( Just account, Just nodeHex ) ->
                if session.publishedNode == Just nodeHex then
                    ( session, NoEffect )

                else
                    ( session
                    , RequestEnroll { serverUrl = session.serverUrl, account = account, nodeHex = nodeHex, gen = session.gen }
                    )

            _ ->
                ( session, NoEffect )


{-| Ports answered the enroll request: fail-closed on generation,
account/node drift, or malformed material. An already-enrolled key
skips `ADD` and goes straight to the residence signature. -}
foldEnrollReply : AttributionSession -> Float -> EnrollReply -> ( AttributionSession, AttributionEffect )
foldEnrollReply session nowMs reply =
    if reply.gen /= session.gen then
        ( session, NoEffect )

    else if Just reply.account /= session.account then
        ( session, NoEffect )

    else if Just reply.nodeHex /= session.nodeHex then
        ( session, NoEffect )

    else if reply.alreadyEnrolled then
        -- The enrolled marker already covers this key: skip ADD and
        -- go straight to the residence signature, mirroring the
        -- oracle `enrollIfNeeded` early-true. No material validation
        -- here — ports omit the self-signature on this path.
        ( session
        , RequestResidenceSign
            { serverUrl = session.serverUrl
            , account = reply.account
            , nodeHex = reply.nodeHex
            , epoch = max nowMs (session.lastEpoch + 1)
            , expiryMs = nowMs + residenceTtlMs
            , gen = session.gen
            }
        )

    else if not (isValidLabel reply.label) || not (isValidPublicHex reply.publicHex) || not (isValidSignature reply.sig) then
        ( session, NoEffect )

    else
        ( { session | pendingEnroll = Just { account = reply.account, label = reply.label, publicHex = reply.publicHex } }
        , SendIdentityAdd { label = reply.label, publicHex = reply.publicHex, sig = reply.sig }
        )


{-| Ports answered the residence signature: generation, node, and
epoch-floor gated, then the proof goes out and the refresh arms. -}
foldResidenceReply : AttributionSession -> Float -> ResidenceReply -> ( AttributionSession, AttributionEffect )
foldResidenceReply session nowMs reply =
    if reply.gen /= session.gen then
        ( session, NoEffect )

    else if Just reply.account /= session.account then
        ( session, NoEffect )

    else if Just reply.nodeHex /= session.nodeHex then
        ( session, NoEffect )

    else if not (isValidSignature reply.sig) then
        ( session, NoEffect )

    else if reply.epoch < session.lastEpoch then
        ( session, NoEffect )

    else
        ( { session
            | publishedNode = Just reply.nodeHex
            , lastEpoch = reply.epoch
            , refreshDueMs = Just (nowMs + residenceRefreshMs)
          }
        , SendIdentityResidence
            { nodeHex = reply.nodeHex
            , epoch = reply.epoch
            , expiryMs = reply.expiryMs
            , sig = reply.sig
            }
        )


{-| Server `IDENTITY ADDED label=…` confirmation: only the pending
label commits the enrolled marker (mirrors `observe`). -}
foldAddedNotice : AttributionSession -> String -> ( AttributionSession, AttributionEffect )
foldAddedNotice session label =
    case session.pendingEnroll of
        Just pending ->
            if label == pending.label then
                ( { session | pendingEnroll = Nothing }
                , ConfirmEnrolled { serverUrl = session.serverUrl, account = pending.account, publicHex = pending.publicHex }
                )

            else
                ( session, NoEffect )

        Nothing ->
            ( session, NoEffect )


{-| Server `IDENTITY RESIDENCE PUBLISHED` confirmation: re-arms the
single stale-epoch retry. -}
foldPublishedNotice : AttributionSession -> ( AttributionSession, AttributionEffect )
foldPublishedNotice session =
    ( { session | staleRetried = False }, NoEffect )


{-| `FAIL IDENTITY STALE_EPOCH`: one bounded retry with a bumped
epoch floor (mirrors `observe`). -}
foldStaleEpoch : AttributionSession -> ( AttributionSession, AttributionEffect )
foldStaleEpoch session =
    if session.staleRetried then
        ( session, NoEffect )

    else
        case ( session.account, session.nodeHex ) of
            ( Just _, Just _ ) ->
                kickAttribution
                    { session
                        | staleRetried = True
                        , lastEpoch = session.lastEpoch + staleEpochBumpMs
                        , publishedNode = Nothing
                    }

            _ ->
                ( session, NoEffect )


{-| Refresh beat: a lapsed proof re-signs the same node (mirrors
the refresh timer). -}
tickRefresh : AttributionSession -> Float -> ( AttributionSession, AttributionEffect )
tickRefresh session nowMs =
    case session.refreshDueMs of
        Nothing ->
            ( session, NoEffect )

        Just due ->
            if nowMs < due then
                ( session, NoEffect )

            else
                kickAttribution
                    { session | publishedNode = Nothing, refreshDueMs = Nothing }
