module TimedBlock exposing
    ( Self
    , check
    , globMatch
    , notes
    , reviewSummary
    )

{-| v3/gap-people — safety checks for the room desk's timed block.

The timed block used to send `MODE #room +b <mask>` the moment the
form was submitted, with no review and no guard, so `*!*@*` (or an
extban such as `$a:*`) blocked the whole room — the person sending it
included. Now the form stages a review, and these checks run first:

  - **Matches everyone** — a plain mask with no literal nick, user or
    host characters (`Moderation.isDangerousBanMask`), an extban whose
    pattern is only wildcards (`$a:*`, `$r:*`, `$m:*!*@*`), or a bare
    `$z` (every TLS client — on Onyx that is every web user).
  - **Matches you** — a plain (or `$m:`) mask whose nick part matches
    your nick while the rest is wildcards, or an account extban that
    matches your account (`$a:<you>`; `$~a:<other>` when you are not
    that account, or a guest).

Negated extbans that cannot be evaluated here (`$~c:`, `$~g:` …) pass,
but the review says what negation means.

-}

import Moderation
import Modes


{-| The person adding the block. -}
type alias Self =
    { nick : String
    , account : Maybe String
    }


everyone : String
everyone =
    "That block would match everyone. Use a more specific address."


yourself : String
yourself =
    "That block would match you. Use an address that leaves you out."


{-| The first reason the mask must not be added, if any. -}
check : Self -> String -> Maybe String
check self raw =
    let
        mask =
            String.trim raw
    in
    if String.startsWith "$" mask then
        case Modes.parseExtBan mask of
            Nothing ->
                Just "That extended ban does not validate — check the type and pattern."

            Just ext ->
                checkExt self ext

    else
        checkPlain self mask


checkPlain : Self -> String -> Maybe String
checkPlain self mask =
    if String.isEmpty mask then
        Just "Enter a ban mask."

    else if Moderation.isDangerousBanMask mask then
        Just everyone

    else if matchesNick self.nick mask then
        Just yourself

    else
        Nothing


onlyWildcards : String -> Bool
onlyWildcards text =
    String.isEmpty (String.filter (\c -> c /= '*' && c /= '?') text)


checkExt : Self -> Modes.ExtBan -> Maybe String
checkExt self ext =
    case ( ext.banType, ext.negated ) of
        ( 'z', False ) ->
            if String.isEmpty ext.mask || onlyWildcards ext.mask then
                Just "That block would match everyone on a secure connection — almost everyone. Use a certificate fingerprint."

            else
                Nothing

        ( 'a', negated ) ->
            let
                matchesUs =
                    case self.account of
                        Just account ->
                            globMatch ext.mask account

                        Nothing ->
                            False
            in
            if not negated && onlyWildcards ext.mask then
                Just everyone

            else if matchesUs /= negated then
                Just yourself

            else
                Nothing

        ( 'm', False ) ->
            checkPlain self ext.mask

        ( _, False ) ->
            if onlyWildcards ext.mask && ext.banType /= 'o' then
                Just everyone

            else
                Nothing

        ( _, True ) ->
            Nothing


{-| Plain mask (or nick-only mask) whose nick part matches `nick`
while user and host are all wildcards. -}
matchesNick : String -> String -> Bool
matchesNick nick mask =
    let
        ( nickPart, rest ) =
            case String.indexes "!" mask of
                at :: _ ->
                    ( String.left at mask, String.dropLeft (at + 1) mask )

                [] ->
                    case String.indexes "@" mask of
                        at :: _ ->
                            ( "*", String.dropLeft at mask )

                        [] ->
                            ( mask, "" )
    in
    not (String.isEmpty (String.trim nick))
        && globMatch nickPart nick
        && onlyWildcards (String.filter (\c -> c /= '@') rest)


{-| Case-insensitive IRC glob: `*` any run, `?` one character. -}
globMatch : String -> String -> Bool
globMatch pattern value =
    globChars (String.toList (String.toLower pattern)) (String.toList (String.toLower value))


globChars : List Char -> List Char -> Bool
globChars pattern value =
    case pattern of
        [] ->
            List.isEmpty value

        '*' :: rest ->
            globChars rest value
                || (case value of
                        [] ->
                            False

                        _ :: more ->
                            globChars pattern more
                   )

        '?' :: rest ->
            case value of
                [] ->
                    False

                _ :: more ->
                    globChars rest more

        c :: rest ->
            case value of
                v :: more ->
                    c == v && globChars rest more

                [] ->
                    False


{-| Review notes for a mask that passed `check`. -}
notes : String -> List String
notes raw =
    case Modes.parseExtBan (String.trim raw) of
        Just ext ->
            if ext.negated then
                [ "Negated: this blocks everyone who does not match the pattern." ]

            else
                []

        Nothing ->
            []


{-| One-line review summary. -}
reviewSummary : { mask : String, room : String, minutes : Int } -> String
reviewSummary input =
    "Block "
        ++ input.mask
        ++ " in "
        ++ input.room
        ++ " for "
        ++ durationText input.minutes
        ++ ". This device lifts it automatically when the time is up."


durationText : Int -> String
durationText minutes =
    let
        plural n word =
            String.fromInt n
                ++ " "
                ++ word
                ++ (if n == 1 then
                        ""

                    else
                        "s"
                   )
    in
    if minutes >= 1440 && modBy 1440 minutes == 0 then
        plural (minutes // 1440) "day"

    else if minutes >= 60 && modBy 60 minutes == 0 then
        plural (minutes // 60) "hour"

    else
        plural minutes "minute"
