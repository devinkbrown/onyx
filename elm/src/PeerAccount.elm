module PeerAccount exposing
    ( Accounts
    , Knowledge(..)
    , WhoxRow
    , empty
    , foldMessage
    , knowledge
    , maxEntries
    , parseWhoxRow
    , whoxSelector
    , whoxToken
    )

{-| v3/gap-people — who is signed in, for everyone we can see.

The server tells us a peer's account in four places, and Elm used to
read only WHOIS 330, so registered people read as "Guest":

  - **extended-join** — `:nick!u@h JOIN #room <account|*> :realname`
  - **account-notify** — `:nick!u@h ACCOUNT <account|*>`
  - **account-tag** — `@account=<account>` on anything they send
  - **WHOX** — the roster request on our own join,
    `WHO #room %tcnfa,616` → `354 me 616 #room nick flags <account|0>`

plus WHOIS 330 (`330 me nick account :is logged in as`). All fold into
one network-wide map keyed by the lowercased nick: `Just account`
(signed in), `Nothing` (known guest). A nick absent from the map is
unknown. NICK moves the entry, QUIT drops it; the caller clears the
map when the socket closes (a new connection re-learns it from the
WHOX on rejoin).

Only positive evidence comes from the account tag: its absence on a
relayed or replayed line is not proof of a logout.

-}

import Dict exposing (Dict)
import Wire


type alias Accounts =
    Dict String (Maybe String)


{-| What the client knows about one peer. -}
type Knowledge
    = SignedIn String
    | Guest
    | Unknown


empty : Accounts
empty =
    Dict.empty


{-| Bound on remembered peers (rooms hold up to 4,096 people; a few
large rooms share many). New nicks past the bound are not recorded;
known ones still update. -}
maxEntries : Int
maxEntries =
    20000


maxAccountLength : Int
maxAccountLength =
    64


maxNickLength : Int
maxNickLength =
    256


{-| The WHOX request token — any 1–3 digit token works; the client
only folds 354 rows that carry it, so other WHOX replies (a typed
`/who %…`) still reach the numeric log untouched. -}
whoxToken : String
whoxToken =
    "616"


{-| Fields in canonical WHOX order (t c n f a), so servers that answer
in canonical order and servers that echo the selector order (Onyx
Server) produce the same row shape. -}
whoxSelector : String
whoxSelector =
    "%tcnfa," ++ whoxToken


knowledge : String -> Accounts -> Knowledge
knowledge nick accounts =
    case Dict.get (String.toLower nick) accounts of
        Just (Just account) ->
            SignedIn account

        Just Nothing ->
            Guest

        Nothing ->
            Unknown


validToken : Int -> String -> Bool
validToken maxLength value =
    not (String.isEmpty value)
        && String.length value <= maxLength
        && not (String.any (\c -> c <= ' ' || Char.toCode c == 127) value)
        && not (String.startsWith ":" value)
        && not (String.contains "," value)


{-| `*` (and WHOX `0`) mean "not signed in"; anything else must be a
plain token. Malformed values say nothing. -}
accountParam : String -> String -> Maybe (Maybe String)
accountParam guestMark raw =
    if raw == guestMark then
        Just Nothing

    else if validToken maxAccountLength raw then
        Just (Just raw)

    else
        Nothing


record : String -> Maybe String -> Accounts -> Accounts
record nick account accounts =
    if not (validToken maxNickLength nick) then
        accounts

    else
        let
            key =
                String.toLower nick
        in
        if Dict.member key accounts || Dict.size accounts < maxEntries then
            Dict.insert key account accounts

        else
            accounts


{-| One WHOX roster row for our token. -}
type alias WhoxRow =
    { channel : String
    , nick : String
    , away : Bool
    , account : Maybe String
    }


{-| Parse `354 <me> <token> <#room> <nick> <flags> <account|0>`. Rows
for another token (or another shape) are `Nothing`. -}
parseWhoxRow : Wire.IrcMessage -> Maybe WhoxRow
parseWhoxRow message =
    if message.command /= "354" then
        Nothing

    else
        case message.params of
            [ _, token, channel, nick, flags, account ] ->
                if token /= whoxToken || not (validToken 512 channel) || not (validToken maxNickLength nick) then
                    Nothing

                else
                    case accountParam "0" account of
                        Just known ->
                            Just
                                { channel = channel
                                , nick = nick
                                , away = String.startsWith "G" flags
                                , account = known
                                }

                        Nothing ->
                            Nothing

            _ ->
                Nothing


{-| Fold one live wire line. -}
foldMessage : Wire.IrcMessage -> Accounts -> Accounts
foldMessage message accounts =
    let
        sender =
            Maybe.withDefault "" message.nick

        tagged =
            -- account-tag: positive evidence only.
            case Dict.get "account" message.tags of
                Just raw ->
                    if String.isEmpty sender || message.command == "ACCOUNT" then
                        accounts

                    else
                        case accountParam "*" raw of
                            Just (Just account) ->
                                record sender (Just account) accounts

                            _ ->
                                accounts

                Nothing ->
                    accounts
    in
    case ( message.command, message.params ) of
        ( "JOIN", _ :: account :: _ ) ->
            -- extended-join (a plain JOIN carries the room only).
            case accountParam "*" account of
                Just known ->
                    record sender known tagged

                Nothing ->
                    tagged

        ( "ACCOUNT", account :: _ ) ->
            case accountParam "*" account of
                Just known ->
                    record sender known tagged

                Nothing ->
                    tagged

        ( "NICK", next :: _ ) ->
            let
                old =
                    String.toLower sender
            in
            case Dict.get old tagged of
                Just known ->
                    record next known (Dict.remove old tagged)

                Nothing ->
                    tagged

        ( "QUIT", _ ) ->
            Dict.remove (String.toLower sender) tagged

        ( "330", _ :: nick :: account :: _ ) ->
            -- WHOIS: "<nick> is logged in as <account>".
            if message.nick == Nothing then
                case accountParam "*" account of
                    Just (Just known) ->
                        record nick (Just known) tagged

                    _ ->
                        tagged

            else
                tagged

        ( "354", _ ) ->
            if message.nick == Nothing then
                case parseWhoxRow message of
                    Just row ->
                        record row.nick row.account tagged

                    Nothing ->
                        tagged

            else
                tagged

        _ ->
            tagged
