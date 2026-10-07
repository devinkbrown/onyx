module Passkey exposing
    ( PasskeyAction(..)
    , PasskeyCredential
    , PasskeyEffect(..)
    , PasskeySession
    , beginAuth
    , beginList
    , blankPasskeySession
    , ceremonyTimeoutMs
    , credentialAlgs
    , foldPasskeyReply
    , maxCredentialIdLength
    , maxCredentials
    , maxLabelLength
    , minChallengeBytes
    , settleAuth
    , validateChallenge
    , validateCreateArgs
    , validateCredentialId
    , validateGetArgs
    , validateRpId
    , webauthnAuth
    , webauthnAuthFinish
    , webauthnList
    , webauthnRegister
    , webauthnRegisterFinish
    , webauthnRemove
    , webauthnRename
    )

{-| WebAuthn passkeys — Elm port of `lib/webauthn/passkey.ts`
(ceremony option validation, response field shapes) and the
`store.ts` `WEBAUTHN <SUBTYPE>` reply fold (protocol: fail-closed
challenge, host-label rp_id, ES256/EdDSA only).

`navigator.credentials` stays behind ports: `validateCreateArgs` /
`validateGetArgs` produce the exact validated inputs the ceremony
port consumes, and `PasskeyEffect` tells `App` which ceremony to run
or which `WEBAUTHN …-FINISH` line to send. The 80ms ALLOW-CRED
settling timer is `App`'s (a port-scheduled tick calling back into
`settleAuth`); the accumulation rules here are timer-free and pure.

`createdAt`/`signCount` divergence: the oracle accepts values past
2^31-1 (createdAt bound is year 9999). Elm `Int` is 32-bit, so those
fail closed to `Nothing`/0 — the established codebase convention.

-}

import Base64Url
import Wire


minChallengeBytes : Int
minChallengeBytes =
    16


maxCredentialIdLength : Int
maxCredentialIdLength =
    1364


maxLabelLength : Int
maxLabelLength =
    256


maxCredentials : Int
maxCredentials =
    64


ceremonyTimeoutMs : Int
ceremonyTimeoutMs =
    120000


{-| ES256 (-7) and EdDSA (-8) — the algorithms the daemon's COSE
parser accepts.
-}
credentialAlgs : List Int
credentialAlgs =
    [ -7, -8 ]


type PasskeyAction
    = ActionRegister
    | ActionRemove
    | ActionRename


type alias PasskeyCredential =
    { id : String
    , label : String
    , signCount : Int
    , createdAt : Maybe Int
    }


type alias PendingAuth =
    { challenge : String
    , rpId : String
    , allowCreds : List String
    , malformedAllowCreds : Bool
    }


type alias PasskeySession =
    { lastAction : Maybe PasskeyAction
    , pendingList : Maybe (List PasskeyCredential)
    , pendingAuth : Maybe PendingAuth
    , creds : List PasskeyCredential
    , busy : Bool
    , error : Maybe String
    , notice : Maybe String
    , supported : Maybe Bool
    , renameUnsupported : Bool
    }


type PasskeyEffect
    = NoEffect
    | RunCreateCeremony { challenge : List Int, rpId : String, account : String }
    | RunGetCeremony { challenge : List Int, rpId : String, allowCreds : List (List Int) }
    | SendLine String
    | ReportError String


blankPasskeySession : PasskeySession
blankPasskeySession =
    { lastAction = Nothing
    , pendingList = Nothing
    , pendingAuth = Nothing
    , creds = []
    , busy = False
    , error = Nothing
    , notice = Nothing
    , supported = Nothing
    , renameUnsupported = False
    }


{-| Strict base64url challenge with spec-minimum entropy (WebAuthn L2
§13.4.3): shorter challenges weaken replay resistance, so they refuse
fail-closed before any device prompt.
-}
validateChallenge : String -> Maybe (List Int)
validateChallenge challengeB64url =
    case Base64Url.decode challengeB64url of
        Nothing ->
            Nothing

        Just bytes ->
            if List.length bytes < minChallengeBytes then
                Nothing

            else
                Just bytes


{-| Relying-party id: non-empty host label, no whitespace. The browser
additionally enforces a registrable suffix of the origin.
-}
validateRpId : String -> Maybe String
validateRpId rpId =
    if String.isEmpty rpId then
        Nothing

    else if String.any (\c -> Char.toCode c <= 32 || Char.toCode c == 127) rpId then
        Nothing

    else
        Just rpId


{-| Credential ids are at most 1023 bytes (1364 base64url chars).
-}
validateCredentialId : String -> Maybe String
validateCredentialId value =
    if String.isEmpty value || String.length value > maxCredentialIdLength then
        Nothing

    else
        case Base64Url.decode value of
            Nothing ->
                Nothing

            Just bytes ->
                if List.isEmpty bytes then
                    Nothing

                else
                    Just value


{-| Strip control chars, cap at 256, drop a trailing lone surrogate.
-}
boundedLabel : String -> String
boundedLabel value =
    let
        stripped =
            String.filter (\c -> not (Char.toCode c <= 31 || Char.toCode c == 127)) value

        cut =
            String.left maxLabelLength stripped
    in
    case List.reverse (String.toList cut) of
        last :: _ ->
            let
                code =
                    Char.toCode last
            in
            if code >= 0xD800 && code <= 0xDBFF then
                String.dropRight 1 cut

            else
                cut

        [] ->
            cut


{-| Strict unsigned integer capped at `Int` range. Values past 2^31-1
fail closed (the oracle accepts signCount to 0xFFFFFFFF and createdAt
to year 9999) — the established 32-bit codebase convention.
-}
boundedUint : String -> Maybe Int
boundedUint value =
    if String.isEmpty value then
        Nothing

    else if not (String.all Char.isDigit value) then
        Nothing

    else if String.length value > 1 && String.startsWith "0" value then
        Nothing

    else if String.length value > 10 then
        Nothing

    else
        case String.toInt value of
            Nothing ->
                Nothing

            Just n ->
                if n < 0 then
                    Nothing

                else
                    Just n


{-| Validated registration ceremony inputs: the user handle binds the
credential to the account (stable, non-secret bytes).
-}
validateCreateArgs : { challenge : String, rpId : String, account : String } -> Maybe { challenge : List Int, rpId : String, account : String }
validateCreateArgs args =
    case ( validateChallenge args.challenge, validateRpId args.rpId ) of
        ( Just bytes, Just rpId ) ->
            if String.isEmpty args.account then
                Nothing

            else
                Just { challenge = bytes, rpId = rpId, account = args.account }

        _ ->
            Nothing


{-| Validated assertion ceremony inputs. One malformed allow-cred id
fails the whole ceremony (truncating the server-authorized list would
change which credentials may answer).
-}
validateGetArgs : { challenge : String, rpId : String, allowCreds : List String } -> Maybe { challenge : List Int, rpId : String, allowCreds : List (List Int) }
validateGetArgs args =
    case ( validateChallenge args.challenge, validateRpId args.rpId ) of
        ( Just bytes, Just rpId ) ->
            let
                decoded =
                    List.foldr
                        (\id acc ->
                            case ( validateCredentialId id, acc ) of
                                ( Just _, Just rest ) ->
                                    Maybe.map2 (\b r -> b :: r)
                                        (Base64Url.decode id)
                                        (Just rest)

                                _ ->
                                    Nothing
                        )
                        (Just [])
                        args.allowCreds
            in
            Maybe.map (\creds -> { challenge = bytes, rpId = rpId, allowCreds = creds }) decoded

        _ ->
            Nothing



-- ── Wire builders ────────────────────────────────────────────────────


wireToken : String -> Maybe String
wireToken value =
    if String.isEmpty value || String.length value > 512 then
        Nothing

    else if String.any (\c -> c <= ' ' || Char.toCode c == 127) value then
        Nothing

    else
        Just value


webauthnRegister : Maybe String -> String
webauthnRegister label =
    case Maybe.map String.trim label of
        Just trimmed ->
            if String.isEmpty trimmed then
                Wire.formatIrcLine "WEBAUTHN" [ "REGISTER" ]

            else
                case wireToken trimmed of
                    Just safe ->
                        Wire.formatIrcLine "WEBAUTHN" [ "REGISTER", safe ]

                    Nothing ->
                        Wire.formatIrcLine "WEBAUTHN" [ "REGISTER" ]

        Nothing ->
            Wire.formatIrcLine "WEBAUTHN" [ "REGISTER" ]


webauthnAuth : String -> Maybe String
webauthnAuth account =
    Maybe.map (\a -> Wire.formatIrcLine "WEBAUTHN" [ "AUTH", a ]) (wireToken (String.trim account))


webauthnList : String
webauthnList =
    Wire.formatIrcLine "WEBAUTHN" [ "LIST" ]


webauthnRemove : String -> Maybe String
webauthnRemove target =
    Maybe.map (\t -> Wire.formatIrcLine "WEBAUTHN" [ "REMOVE", t ]) (wireToken target)


webauthnRename : String -> String -> Maybe String
webauthnRename target label =
    case ( wireToken target, wireToken (String.trim label) ) of
        ( Just t, Just l ) ->
            Just (Wire.formatIrcLine "WEBAUTHN" [ "RENAME", t, l ])

        _ ->
            Nothing


webauthnRegisterFinish : String -> String -> String -> Maybe String
webauthnRegisterFinish credId clientData authData =
    case ( validateCredentialId credId, validateChallengeField clientData, validateChallengeField authData ) of
        ( Just c, Just d, Just a ) ->
            Just (Wire.formatIrcLine "WEBAUTHN" [ "REGISTER-FINISH", c, d, a ])

        _ ->
            Nothing


webauthnAuthFinish : String -> String -> String -> String -> Maybe String
webauthnAuthFinish credId clientData authData signature =
    case validateCredentialId credId of
        Nothing ->
            Nothing

        Just c ->
            case ( validateChallengeField clientData, validateChallengeField authData, validateChallengeField signature ) of
                ( Just d, Just a, Just s ) ->
                    Just (Wire.formatIrcLine "WEBAUTHN" [ "AUTH-FINISH", c, d, a, s ])

                _ ->
                    Nothing


{-| Non-empty strict base64url (ceremony response fields carry no
minimum length of their own).
-}
validateChallengeField : String -> Maybe String
validateChallengeField value =
    if String.isEmpty value then
        Nothing

    else
        case Base64Url.decode value of
            Nothing ->
                Nothing

            Just bytes ->
                if List.isEmpty bytes then
                    Nothing

                else
                    Just value



-- ── Reply fold ───────────────────────────────────────────────────────


beginList : PasskeySession -> PasskeySession
beginList session =
    { session | pendingList = Just [], lastAction = Nothing }


beginAuth : PasskeySession -> PasskeySession
beginAuth session =
    { session | pendingAuth = Nothing }


{-| Settle a collected AUTH-CHALLENGE once ALLOW-CRED lines stop
arriving (`App` schedules the tick): missing fields or a malformed
allow-list fail the ceremony instead of prompting the device.
-}
settleAuth : PasskeySession -> ( PasskeySession, PasskeyEffect )
settleAuth session =
    case session.pendingAuth of
        Nothing ->
            ( { session | busy = False, error = Just "No passkey challenge to answer." }
            , ReportError "No passkey challenge to answer."
            )

        Just pending ->
            if String.isEmpty pending.challenge || String.isEmpty pending.rpId || pending.malformedAllowCreds then
                ( { session
                    | pendingAuth = Nothing
                    , busy = False
                    , error =
                        Just
                            (if pending.malformedAllowCreds then
                                "Malformed passkey challenge."

                             else
                                "No passkey challenge to answer."
                            )
                  }
                , ReportError
                    (if pending.malformedAllowCreds then
                        "Malformed passkey challenge."

                     else
                        "No passkey challenge to answer."
                    )
                )

            else
                case validateGetArgs { challenge = pending.challenge, rpId = pending.rpId, allowCreds = pending.allowCreds } of
                    Nothing ->
                        ( { session | pendingAuth = Nothing, busy = False, error = Just "Malformed passkey challenge." }
                        , ReportError "Malformed passkey challenge."
                        )

                    Just args ->
                        ( session
                        , RunGetCeremony args
                        )


{-| Fold one `WEBAUTHN <SUBTYPE>` standard reply (re-dispatched from
the EVENT plane by `Spine.foldEventLine`, or a real FAIL/WARN).
Context discipline mirrors the oracle: replies that do not belong to
the in-flight action or account are ignored — the session here is
single-transport, so "current" means the matching pending slot is
set; `App` clears slots on transport/account change.
-}
foldPasskeyReply : PasskeySession -> Wire.StandardReply -> ( PasskeySession, PasskeyEffect )
foldPasskeyReply session reply =
    if reply.command /= "WEBAUTHN" then
        ( session, NoEffect )

    else if reply.kind == Wire.Fail || reply.kind == Wire.Warn then
        -- A failure that owns no in-flight list, action, or ceremony
        -- answers nothing we asked — ignore it like the oracle's
        -- reply-context ownership gate, so a stray FAIL never plants
        -- a phantom error in the panel.
        if session.busy || session.pendingList /= Nothing || session.pendingAuth /= Nothing || session.lastAction /= Nothing then
            ( failPasskeySession session reply, ReportError (Maybe.withDefault reply.code (nonEmpty reply.description)) )

        else
            ( session, NoEffect )

    else
        foldPasskeyCode session reply


nonEmpty : String -> Maybe String
nonEmpty text =
    if String.isEmpty text then
        Nothing

    else
        Just text


failPasskeySession : PasskeySession -> Wire.StandardReply -> PasskeySession
failPasskeySession session reply =
    let
        renameOff =
            session.lastAction == Just ActionRename && reply.code == "INVALID_SUBCOMMAND"

        featureOff =
            reply.code == "TEMPORARILY_UNAVAILABLE"
    in
    { session
        | pendingAuth = Nothing
        , pendingList = Nothing
        , lastAction = Nothing
        , busy = False
        , error =
            Just
                (if renameOff then
                    "This server does not support renaming passkeys yet."

                 else if String.isEmpty reply.description then
                    reply.code

                 else
                    reply.description
                )
        , supported =
            if featureOff then
                Just False

            else
                session.supported
        , renameUnsupported = session.renameUnsupported || renameOff
    }


foldPasskeyCode : PasskeySession -> Wire.StandardReply -> ( PasskeySession, PasskeyEffect )
foldPasskeyCode session reply =
    case reply.code of
        "REGISTER-CHALLENGE" ->
            if session.lastAction /= Just ActionRegister then
                ( session, NoEffect )

            else
                case ( contextAt 0 reply.context, contextAt 1 reply.context ) of
                    ( Just challenge, Just rpId ) ->
                        case validateCreateArgs { challenge = challenge, rpId = rpId, account = reply.description } of
                            Nothing ->
                                ( { session | busy = False, error = Just "Malformed passkey challenge." }
                                , ReportError "Malformed passkey challenge."
                                )

                            Just args ->
                                ( session, RunCreateCeremony args )

                    _ ->
                        ( { session | busy = False, error = Just "Malformed passkey challenge." }
                        , ReportError "Malformed passkey challenge."
                        )

        "REGISTERED" ->
            if session.lastAction /= Just ActionRegister then
                ( session, NoEffect )

            else
                ( { session
                    | lastAction = Nothing
                    , busy = False
                    , error = Nothing
                    , supported = Just True
                    , notice =
                        Just
                            (if String.isEmpty reply.description then
                                "Passkey added"

                             else
                                "Passkey added (" ++ reply.description ++ ")"
                            )
                  }
                , SendLine webauthnList
                )

        "CRED" ->
            case session.pendingList of
                Nothing ->
                    ( session, NoEffect )

                Just rows ->
                    case contextAt 0 reply.context of
                        Nothing ->
                            ( session, NoEffect )

                        Just id ->
                            if validateCredentialId id == Nothing then
                                ( session, NoEffect )

                            else if List.length rows >= maxCredentials then
                                ( session, NoEffect )

                            else if List.any (\c -> c.id == id) rows then
                                ( session, NoEffect )

                            else
                                let
                                    signCount =
                                        Maybe.withDefault 0 (Maybe.andThen boundedUint (contextAt 1 reply.context))
                                in
                                ( { session
                                    | pendingList =
                                        Just
                                            (rows
                                                ++ [ { id = id
                                                     , label = boundedLabel reply.description
                                                     , signCount = signCount
                                                     , createdAt = Maybe.andThen boundedUint (contextAt 2 reply.context)
                                                     }
                                                   ]
                                            )
                                  }
                                , NoEffect
                                )

        "LIST" ->
            case session.pendingList of
                Nothing ->
                    ( session, NoEffect )

                Just rows ->
                    ( { session
                        | pendingList = Nothing
                        , creds = rows
                        , supported = Just True
                      }
                    , NoEffect
                    )

        "REMOVED" ->
            if session.lastAction /= Just ActionRemove then
                ( session, NoEffect )

            else
                ( { session
                    | lastAction = Nothing
                    , busy = False
                    , error = Nothing
                    , supported = Just True
                    , notice = Just "Passkey removed"
                    , creds =
                        List.filter
                            (\c -> c.id /= reply.description && c.label /= reply.description)
                            session.creds
                  }
                , NoEffect
                )

        "RENAMED" ->
            if session.lastAction /= Just ActionRename then
                ( session, NoEffect )

            else
                case contextAt 0 reply.context of
                    Nothing ->
                        ( session, NoEffect )

                    Just id ->
                        ( { session
                            | lastAction = Nothing
                            , busy = False
                            , error = Nothing
                            , supported = Just True
                            , notice = Just "Passkey renamed"
                            , creds =
                                List.map
                                    (\c ->
                                        if c.id == id then
                                            { c | label = reply.description }

                                        else
                                            c
                                    )
                                    session.creds
                          }
                        , NoEffect
                        )

        "STATUS" ->
            ( { session | supported = Just True }, NoEffect )

        "AUTH-CHALLENGE" ->
            case session.pendingAuth of
                Just _ ->
                    ( session, NoEffect )

                Nothing ->
                    ( { session
                        | pendingAuth =
                            Just
                                { challenge = Maybe.withDefault "" (contextAt 0 reply.context)
                                , rpId = Maybe.withDefault "" (contextAt 1 reply.context)
                                , allowCreds = []
                                , malformedAllowCreds = False
                                }
                      }
                    , NoEffect
                    )

        "ALLOW-CRED" ->
            case session.pendingAuth of
                Nothing ->
                    ( session, NoEffect )

                Just pending ->
                    if String.isEmpty reply.description then
                        ( session, NoEffect )

                    else if validateCredentialId reply.description == Nothing then
                        -- Truncating the authorized allow-list would change
                        -- which credentials may answer: fail the ceremony.
                        ( { session | pendingAuth = Just { pending | malformedAllowCreds = True } }
                        , NoEffect
                        )

                    else if List.member reply.description pending.allowCreds then
                        ( session, NoEffect )

                    else if List.length pending.allowCreds >= maxCredentials then
                        ( { session | pendingAuth = Just { pending | malformedAllowCreds = True } }
                        , NoEffect
                        )

                    else
                        ( { session
                            | pendingAuth =
                                Just { pending | allowCreds = pending.allowCreds ++ [ reply.description ] }
                          }
                        , NoEffect
                        )

        _ ->
            ( session, NoEffect )


contextAt : Int -> List String -> Maybe String
contextAt index context =
    List.head (List.drop index context)
