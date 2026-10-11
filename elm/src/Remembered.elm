module Remembered exposing
    ( Identity
    , State
    , actionLabel
    , actionTestId
    , blank
    , decodeListing
    , forget
    , listed
    , select
    , selected
    , statusLabel
    , visible
    )

{-| v3/rx-public — remembered identities on the join screen ("Stay
signed in"), mirroring the Solid `Connect.tsx` identity switcher over
`listRememberedIdentities` / `selectRememberedIdentity` /
`removeRememberedIdentity`.

Only sanitized metadata ever enters this state: an opaque picker id, the
display nick, a server label, when it was saved, whether it is the
active identity, and what it can do (`Credentials.RememberedIdentityAccess`).
Passwords and resume tokens stay in `ports.js` (the `onyx:credentials`
slot store): "Sign in" / "Resume" ask the ports to arm the SASL holder
and only learn back whether a password was held.

Listing payloads are decoded element-wise and fail-closed — a malformed
entry is dropped, never repaired — and re-bounded here (12 entries,
nick shape, 256-char labels) even though the ports already bound them.

-}

import Credentials exposing (RememberedIdentityAccess(..))
import Json.Decode as Decode
import Regex


type alias Identity =
    { id : String
    , nick : String
    , server : String
    , savedAt : String
    , active : Bool
    , access : RememberedIdentityAccess
    }


{-| `stay` is the "Stay signed in" switch; `pending` is the remember
decision staged by a sign-in until the server accepts the account;
`using` is the identity whose stored credentials the ports are arming.
-}
type alias State =
    { identities : List Identity
    , selectedId : Maybe String
    , dismissed : Bool
    , loaded : Bool
    , stay : Bool
    , pending : Maybe Bool
    , using : Maybe String
    }


blank : State
blank =
    { identities = []
    , selectedId = Nothing
    , dismissed = False
    , loaded = False
    , stay = False
    , pending = Nothing
    , using = Nothing
    }


idPattern : Regex.Regex
idPattern =
    Regex.fromString "^saved-[0-9a-z]{1,8}-[0-9a-z]{1,8}$"
        |> Maybe.withDefault Regex.never


accessDecoder : Decode.Decoder RememberedIdentityAccess
accessDecoder =
    Decode.string
        |> Decode.andThen
            (\raw ->
                case raw of
                    "resume" ->
                        Decode.succeed ResumeAccess

                    "sign-in" ->
                        Decode.succeed SignInAccess

                    "identity-only" ->
                        Decode.succeed IdentityOnlyAccess

                    _ ->
                        Decode.fail "access"
            )


identityDecoder : Decode.Decoder Identity
identityDecoder =
    Decode.map6 Identity
        (Decode.field "id" Decode.string)
        (Decode.field "nick" Decode.string)
        (Decode.field "server" Decode.string)
        (Decode.oneOf [ Decode.field "savedAt" Decode.string, Decode.succeed "" ])
        (Decode.oneOf [ Decode.field "active" Decode.bool, Decode.succeed False ])
        (Decode.field "access" accessDecoder)
        |> Decode.andThen
            (\raw ->
                case ( Regex.contains idPattern raw.id, Credentials.sanitizeCredentialNick raw.nick ) of
                    ( True, Just nick ) ->
                        Decode.succeed
                            { raw
                                | nick = nick
                                , server = String.left Credentials.maxHandoffField (String.filter (\c -> Char.toCode c >= 0x20 && Char.toCode c /= 0x7F) raw.server)
                                , savedAt = String.left 64 raw.savedAt
                            }

                    _ ->
                        Decode.fail "identity"
            )


{-| Element-wise, fail-closed: junk entries drop, duplicates (by id)
keep the first, at most one stays `active`, capped at 12.
-}
decodeListing : Decode.Value -> List Identity
decodeListing value =
    let
        entries =
            Decode.decodeValue (Decode.list Decode.value) value
                |> Result.withDefault []
                |> List.filterMap (Decode.decodeValue identityDecoder >> Result.toMaybe)

        dedupe entry ( seen, acc, activeSeen ) =
            if List.member entry.id seen then
                ( seen, acc, activeSeen )

            else
                ( entry.id :: seen
                , { entry | active = entry.active && not activeSeen } :: acc
                , activeSeen || entry.active
                )

        ( _, kept, _ ) =
            List.foldl dedupe ( [], [], False ) entries
    in
    List.reverse kept |> List.take Credentials.maxHandoffs


{-| A fresh listing: keep the selection while it still exists, else the
active identity, else the first (mirroring `refreshRememberedIdentities`).
A use in flight for a vanished identity is abandoned.
-}
listed : List Identity -> State -> State
listed identities state =
    let
        has id =
            List.any (\i -> i.id == id) identities

        keep =
            case state.selectedId of
                Just id ->
                    if has id then
                        Just id

                    else
                        Nothing

                Nothing ->
                    Nothing

        fallback =
            case List.filter .active identities of
                active :: _ ->
                    Just active.id

                [] ->
                    List.head identities |> Maybe.map .id
    in
    { state
        | identities = identities
        , selectedId =
            case keep of
                Just id ->
                    Just id

                Nothing ->
                    fallback
        , loaded = True
        , using =
            case state.using of
                Just id ->
                    if has id then
                        Just id

                    else
                        Nothing

                Nothing ->
                    Nothing
    }


select : String -> State -> State
select id state =
    if List.any (\i -> i.id == id) state.identities then
        { state | selectedId = Just id }

    else
        state


{-| Optimistic forget; the ports' fresh listing follows. -}
forget : String -> State -> State
forget id state =
    listed (List.filter (\i -> i.id /= id) state.identities)
        { state
            | selectedId =
                if state.selectedId == Just id then
                    Nothing

                else
                    state.selectedId
        }


selected : State -> Maybe Identity
selected state =
    case state.selectedId of
        Just id ->
            List.filter (\i -> i.id == id) state.identities |> List.head

        Nothing ->
            Nothing


{-| The panel shows before a first attempt, outside Create account, until
"Not now". -}
visible : { attempted : Bool, registering : Bool } -> State -> Bool
visible form state =
    not state.dismissed
        && not (List.isEmpty state.identities)
        && not form.attempted
        && not form.registering


actionLabel : RememberedIdentityAccess -> String
actionLabel access =
    case access of
        ResumeAccess ->
            "Resume"

        SignInAccess ->
            "Sign in"

        IdentityOnlyAccess ->
            "Use identity"


statusLabel : RememberedIdentityAccess -> String
statusLabel access =
    case access of
        ResumeAccess ->
            "Ready to continue"

        SignInAccess ->
            "Saved sign-in"

        IdentityOnlyAccess ->
            "Saved name"


actionTestId : RememberedIdentityAccess -> String
actionTestId access =
    case access of
        ResumeAccess ->
            "conn-resume"

        SignInAccess ->
            "conn-remembered-signin"

        IdentityOnlyAccess ->
            "conn-identity-use"
