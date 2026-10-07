module Moderation exposing
    ( ModerationKind(..)
    , Draft
    , NormalizedAction(..)
    , ReviewCopy
    , Validation
    , maxChannelLength
    , maxNickLength
    , maxMaskLength
    , maxReasonLength
    , isModerationKind
    , kindsForMode
    , validateDraft
    , reviewCopy
    , isDangerousBanMask
    )

{-| Pure moderation action drafts (mirroring
`src/lib/moderation/actionModel.ts`: normalize, validate, and
describe a review before anything is sent). -}


maxChannelLength : Int
maxChannelLength =
    256


maxNickLength : Int
maxNickLength =
    50


maxMaskLength : Int
maxMaskLength =
    512


maxReasonLength : Int
maxReasonLength =
    200


{-| Reviewable action kinds. -}
type ModerationKind
    = Kick
    | Ban
    | Unban
    | Op
    | Deop
    | Voice
    | Devoice


{-| An unvalidated draft: every kind shares one record with
optional fields, exactly like the oracle union. -}
type alias Draft =
    { kind : ModerationKind
    , channel : String
    , target : Maybe String
    , mask : Maybe String
    , reason : Maybe String
    }


{-| A validated, normalized action. -}
type NormalizedAction
    = KickAction { channel : String, target : String, reason : Maybe String }
    | BanAction { channel : String, target : Maybe String, mask : String, reason : Maybe String }
    | UnbanAction { channel : String, mask : String }
    | RoleAction { kind : ModerationKind, channel : String, target : String }


{-| Plain-language review copy for the confirm surface. -}
type alias ReviewCopy =
    { title : String
    , summary : String
    , confirmLabel : String
    , impact : String
    }


{-| Validation outcome: the normalized action plus its review
copy, or the list of blocking errors. -}
type alias Validation =
    Result (List String) { action : NormalizedAction, review : ReviewCopy }


{-| Whether a string names a reviewable kind. -}
isModerationKind : String -> Bool
isModerationKind value =
    List.member value [ "kick", "ban", "unban", "op", "deop", "voice", "devoice" ]


{-| Card moderation controls per experience mode (mirroring
`memberModerationKindsForMode`). -}
kindsForMode : String -> List ModerationKind
kindsForMode mode =
    if mode == "network-ops" then
        [ Kick, Ban, Op, Deop, Voice, Devoice ]

    else if mode == "advanced" then
        [ Kick, Ban ]

    else
        []


{-| Validate a draft for an acting nick (mirroring
`validateModerationAction` error for error). -}
validateDraft : Draft -> String -> Validation
validateDraft draft actorNick =
    let
        actor =
            normalizeNick actorNick

        preErrors =
            case actor of
                Nothing ->
                    [ "Your nickname is missing, so this action cannot be reviewed." ]

                Just _ ->
                    []

        channel =
            normalizeChannel draft.channel

        channelErrors =
            case channel of
                Nothing ->
                    [ "Choose a valid room." ]

                Just _ ->
                    []
    in
    case draft.kind of
        Kick ->
            let
                target =
                    Maybe.andThen normalizeNick draft.target

                ( reason, reasonErrors ) =
                    normalizeReason draft.reason

                errors =
                    preErrors
                        ++ channelErrors
                        ++ reasonErrors
                        ++ (case target of
                                Nothing ->
                                    [ "Choose someone to remove." ]

                                Just _ ->
                                    []
                           )
                        ++ selfErrors actor target
            in
            case ( channel, target ) of
                ( Just room, Just person ) ->
                    if List.isEmpty errors then
                        Ok
                            { action = KickAction { channel = room, target = person, reason = reason }
                            , review = reviewCopy (KickAction { channel = room, target = person, reason = reason })
                            }

                    else
                        Err errors

                _ ->
                    Err errors

        Ban ->
            let
                rawTarget =
                    Maybe.map String.trim draft.target
                        |> Maybe.andThen
                            (\value ->
                                if String.isEmpty value then
                                    Nothing

                                else
                                    Just value
                            )

                target =
                    Maybe.andThen normalizeNick rawTarget

                targetErrors =
                    case ( rawTarget, target ) of
                        ( Just _, Nothing ) ->
                            [ "The person to block is not a valid nickname." ]

                        _ ->
                            []

                explicitMask =
                    Maybe.andThen normalizeMask draft.mask

                maskErrors =
                    case ( draft.mask, explicitMask ) of
                        ( Just _, Nothing ) ->
                            [ "Enter a valid block address." ]

                        _ ->
                            []

                mask =
                    case explicitMask of
                        Just value ->
                            Just value

                        Nothing ->
                            Maybe.map (\person -> person ++ "!*@*") target

                derivedErrors =
                    case mask of
                        Nothing ->
                            [ "Enter a person or a block address." ]

                        Just value ->
                            if isDangerousBanMask value then
                                [ "That block would match everyone. Use a more specific address." ]

                            else
                                []

                ( reason, reasonErrors ) =
                    normalizeReason draft.reason

                errors =
                    preErrors
                        ++ channelErrors
                        ++ targetErrors
                        ++ maskErrors
                        ++ derivedErrors
                        ++ reasonErrors
                        ++ selfErrors actor target
                        ++ (case ( actor, mask ) of
                                ( Just self, Just value ) ->
                                    if isSelfBanMask self value then
                                        [ "You cannot moderate yourself." ]

                                    else
                                        []

                                _ ->
                                    []
                           )
            in
            case ( channel, mask ) of
                ( Just room, Just value ) ->
                    if List.isEmpty errors then
                        let
                            action =
                                BanAction { channel = room, target = target, mask = value, reason = reason }
                        in
                        Ok { action = action, review = reviewCopy action }

                    else
                        Err errors

                _ ->
                    Err errors

        Unban ->
            let
                mask =
                    Maybe.andThen normalizeMask draft.mask

                errors =
                    preErrors
                        ++ channelErrors
                        ++ (case mask of
                                Nothing ->
                                    [ "Choose a valid block to lift." ]

                                Just _ ->
                                    []
                           )
            in
            case ( channel, mask ) of
                ( Just room, Just value ) ->
                    if List.isEmpty errors then
                        let
                            action =
                                UnbanAction { channel = room, mask = value }
                        in
                        Ok { action = action, review = reviewCopy action }

                    else
                        Err errors

                _ ->
                    Err errors

        Op ->
            roleDraft draft actor channel Op

        Deop ->
            roleDraft draft actor channel Deop

        Voice ->
            roleDraft draft actor channel Voice

        Devoice ->
            roleDraft draft actor channel Devoice


{-| Shared role-change validation (op/deop/voice/devoice). -}
roleDraft : Draft -> Maybe String -> Maybe String -> ModerationKind -> Validation
roleDraft draft actor channel kind =
    let
        target =
            Maybe.andThen normalizeNick draft.target

        errors =
            (case actor of
                Nothing ->
                    [ "Your nickname is missing, so this action cannot be reviewed." ]

                Just _ ->
                    []
            )
                ++ (case channel of
                        Nothing ->
                            [ "Choose a valid room." ]

                        Just _ ->
                            []
                   )
                ++ (case target of
                        Nothing ->
                            [ "Choose a valid nickname." ]

                        Just _ ->
                            []
                   )
                ++ selfErrors actor target
    in
    case ( channel, target ) of
        ( Just room, Just person ) ->
            if List.isEmpty errors then
                let
                    action =
                        RoleAction { kind = kind, channel = room, target = person }
                in
                Ok { action = action, review = reviewCopy action }

            else
                Err errors

        _ ->
            Err errors


{-| Self-moderation refusal shared by target-carrying kinds. -}
selfErrors : Maybe String -> Maybe String -> List String
selfErrors actor target =
    case ( actor, target ) of
        ( Just self, Just person ) ->
            if String.toLower self == String.toLower person then
                [ "You cannot moderate yourself." ]

            else
                []

        _ ->
            []


{-| Plain-language review copy (mirroring `reviewCopy` verbatim,
curly quotes included). -}
reviewCopy : NormalizedAction -> ReviewCopy
reviewCopy action =
    case action of
        KickAction details ->
            { title = "Remove from room"
            , summary =
                case details.reason of
                    Just reason ->
                        "Remove " ++ details.target ++ " from " ++ details.channel ++ " with the note “" ++ reason ++ "”. They can rejoin unless they are also blocked."

                    Nothing ->
                        "Remove " ++ details.target ++ " from " ++ details.channel ++ ". They can rejoin unless they are also blocked."
            , confirmLabel = "Remove from room"
            , impact = "This sends a kick. It is not undone automatically."
            }

        BanAction details ->
            { title = "Block from room"
            , summary =
                case details.target of
                    Just person ->
                        "Block " ++ person ++ " (" ++ details.mask ++ ") from joining " ++ details.channel ++ "."

                    Nothing ->
                        "Block " ++ details.mask ++ " from joining " ++ details.channel ++ "."
            , confirmLabel = "Block from room"
            , impact = "Matching people stay out until a moderator lifts the block."
            }

        UnbanAction details ->
            { title = "Lift block"
            , summary = "Allow " ++ details.mask ++ " to join " ++ details.channel ++ " again."
            , confirmLabel = "Lift block"
            , impact = "This only lifts the server block. It does not restore a previous role."
            }

        RoleAction details ->
            case details.kind of
                Op ->
                    { title = "Give moderator role"
                    , summary = "Give " ++ details.target ++ " permission to manage " ++ details.channel ++ "."
                    , confirmLabel = "Give moderator role"
                    , impact = "They will be able to change room rules and moderate members."
                    }

                Deop ->
                    { title = "Remove moderator role"
                    , summary = "Remove " ++ details.target ++ "’s permission to manage " ++ details.channel ++ "."
                    , confirmLabel = "Remove moderator role"
                    , impact = "They keep their membership but lose room-management tools."
                    }

                Voice ->
                    { title = "Give speak permission"
                    , summary = "Let " ++ details.target ++ " speak in " ++ details.channel ++ " while the room is moderated."
                    , confirmLabel = "Give speak permission"
                    , impact = "This only matters while the room is in moderated mode."
                    }

                _ ->
                    { title = "Remove speak permission"
                    , summary = "Stop " ++ details.target ++ " from speaking in " ++ details.channel ++ " while the room is moderated."
                    , confirmLabel = "Remove speak permission"
                    , impact = "This only matters while the room is in moderated mode."
                    }


{-| True when a ban mask has no literal nick/user/host characters
left (mirroring `isDangerousBanMask`). -}
isDangerousBanMask : String -> Bool
isDangerousBanMask mask =
    String.isEmpty
        (String.filter (\char -> not (List.member char [ '*', '?', '!', '@', '.' ])) mask)


normalizeChannel : String -> Maybe String
normalizeChannel value =
    let
        channel =
            String.trim value
    in
    if String.isEmpty channel then
        Nothing

    else if String.length channel > maxChannelLength then
        Nothing

    else if hasControlChar channel then
        Nothing

    else if String.contains " " channel then
        -- Whitespace (spaces, tabs, newlines) never belongs in a
        -- room name; the tab/newline halves already fail the
        -- control-char gate, the space half fails here.
        Nothing

    else
        case String.uncons channel of
            Just ( first, _ ) ->
                if first == '#' || first == '&' then
                    Just channel

                else
                    Nothing

            Nothing ->
                Nothing


normalizeNick : String -> Maybe String
normalizeNick value =
    let
        nick =
            String.trim value
    in
    if String.isEmpty nick then
        Nothing

    else if String.length nick > maxNickLength then
        Nothing

    else if hasControlChar nick then
        Nothing

    else if String.any (\char -> List.member char [ ' ', '\t', '\n', '\u{000D}', ',', ':', '*', '?', '!', '@' ]) nick then
        Nothing

    else
        Just nick


normalizeMask : String -> Maybe String
normalizeMask value =
    let
        mask =
            String.trim value
    in
    if String.isEmpty mask then
        Nothing

    else if String.length mask > maxMaskLength then
        Nothing

    else if hasControlChar mask then
        Nothing

    else if String.any (\char -> List.member char [ ' ', '\t', '\n', '\u{000D}' ]) mask then
        Nothing

    else
        Just mask


normalizeReason : Maybe String -> ( Maybe String, List String )
normalizeReason maybeReason =
    case maybeReason of
        Nothing ->
            ( Nothing, [] )

        Just value ->
            if hasControlChar value then
                ( Nothing, [ "The note cannot include control characters." ] )

            else
                let
                    reason =
                        String.trim value
                in
                if String.isEmpty reason then
                    ( Nothing, [] )

                else if String.length reason > maxReasonLength then
                    ( Nothing, [ "Keep the note under " ++ String.fromInt maxReasonLength ++ " characters." ] )

                else
                    ( Just reason, [] )


hasControlChar : String -> Bool
hasControlChar value =
    String.any (\char -> let code = Char.toCode char in code < 0x20 || code == 0x7F) value


isSelfBanMask : String -> String -> Bool
isSelfBanMask actor mask =
    if String.toLower actor == String.toLower mask then
        True

    else
        let
            nickPart =
                List.head (String.split "!" mask) |> Maybe.withDefault ""
        in
        if String.isEmpty nickPart || String.contains "*" nickPart || String.contains "?" nickPart then
            False

        else
            String.toLower actor == String.toLower nickPart
