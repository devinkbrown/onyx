module View.Profile exposing ( moderationReview, profileCard, profileSheet )

{-| Member network-identity sheet (mirroring `WhoisSheet`: a thin
reactive view over the folded WHOIS cache — title, description,
summary, live status, and the details list; the sheet opens through
`WhoisRequest` and closes through `WhoisClose`). -}

import App exposing (Model, Msg(..))
import Dict
import Html exposing (Html, a, button, code, dd, details, div, dl, dt, h2, li, p, small, span, summary, text, time, ul)
import Html.Attributes exposing (attribute, class, datetime, disabled, href)
import Html.Events exposing (on, onClick)
import Json.Decode as Decode
import Modes
import Moderation
import Prefs
import Services
import Set


{-| The open WHOIS sheet, or nothing when no sheet is showing. -}
profileSheet : Model -> Html Msg
profileSheet model =
    case model.whoisTarget of
        Nothing ->
            text ""

        Just nick ->
            sheetFor model nick


sheetFor : Model -> String -> Html Msg
sheetFor model nick =
    let
        shown =
            Maybe.withDefault nick (App.activeWhoisNick model nick)

        info =
            App.whoisInfoFor model nick
    in
    div [ class "onyx-profile-pop" ]
        [ div
            [ class "onyx-profile-backdrop"
            , onClick App.WhoisClose
            ]
            []
        , div
            [ class "onyx-profile-sheet"
            , attribute "role" "dialog"
            , attribute "aria-label" ("Profile: " ++ shown)
            , on "keydown" profileEscapeDecoder
            ]
            [ div [ class "onyx-profile-head" ]
                [ h2 [ class "onyx-profile-title" ] [ text ("Profile: " ++ shown) ]
                , p [ class "onyx-profile-desc" ] [ text "Live network identity and presence details." ]
                , button
                    [ attribute "type" "button"
                    , class "onyx-profile-close"
                    , attribute "aria-label" "Close member profile"
                    , onClick App.WhoisClose
                    ]
                    [ text "Close" ]
                ]
            , profileSummary shown info
            , profileStatus info
            , profileDetails shown info
            ]
        ]


{-| Summary: display nick, services account, and the bot badge. -}
profileSummary : String -> Maybe Services.WhoisInfo -> Html Msg
profileSummary shown info =
    div [ class "onyx-profile-summary" ]
        ([ p [ class "onyx-profile-nick" ] [ text shown ] ]
            ++ (case Maybe.andThen .account info of
                    Just account ->
                        [ p [ class "onyx-profile-account" ] [ text ("~" ++ account) ] ]

                    Nothing ->
                        []
               )
            ++ (case Maybe.map .bot info of
                    Just True ->
                        [ p [ class "onyx-profile-badge" ] [ text "Bot account" ] ]

                    _ ->
                        []
               )
        )


{-| Live status: the loading notice or the settled error. -}
profileStatus : Maybe Services.WhoisInfo -> Html Msg
profileStatus info =
    case info of
        Just current ->
            if current.loading then
                p [ class "onyx-profile-status", attribute "role" "status" ]
                    [ text "Asking the network for profile details…" ]

            else
                case current.error of
                    Just message ->
                        p [ class "onyx-profile-error", attribute "role" "alert" ] [ text message ]

                    Nothing ->
                        text ""

        Nothing ->
            text ""


{-| Details list, or the settled empty note when the network
returned no optional fields (never while loading or errored). -}
profileDetails : String -> Maybe Services.WhoisInfo -> Html Msg
profileDetails shown info =
    case info of
        Nothing ->
            text ""

        Just current ->
            if hasDetails current then
                dl [ class "onyx-profile-details" ]
                    (List.filterMap identity
                        [ Maybe.map (\account -> profileField "Account" [ text account ]) current.account
                        , Maybe.map (\name -> profileField "Name" [ text name ]) current.realname
                        , Maybe.map (\identity -> profileField "Identity" [ text identity ]) (whoisIdentity current)
                        , Maybe.map (\host -> profileField "Host" [ text host ]) current.realHost
                        , nodeField current
                        , roleField current
                        , Maybe.map (\away -> profileField "Away" [ text away ]) current.awayMessage
                        , Maybe.map (\secs -> profileField "Idle" [ text (formatIdle secs) ]) current.idleSecs
                        , Maybe.andThen signOnField current.signOnTs
                        , Maybe.map (\transport -> profileField "Transport" [ text transport ]) current.secureConnection
                        , Maybe.map (\fp -> profileField "Certificate" [ code [ class "onyx-profile-certfp" ] [ text fp ] ]) current.certfp
                        , roomsField shown current
                        , notesField shown current
                        ]
                    )

            else if not current.loading && current.error == Nothing then
                p [ class "onyx-profile-empty" ]
                    [ text "The network returned no additional profile details." ]

            else
                text ""


{-| One labelled details row. -}
profileField : String -> List (Html Msg) -> Html Msg
profileField label children =
    div [ class "onyx-profile-field" ]
        [ dt [] [ text label ]
        , dd [] children
        ]


{-| The `user@host` identity (mirroring the oracle memo: combined
only when both halves are present). -}
whoisIdentity : Services.WhoisInfo -> Maybe String
whoisIdentity current =
    case ( current.username, current.host ) of
        ( Just user, Just host ) ->
            Just (user ++ "@" ++ host)

        ( Just user, Nothing ) ->
            Just user

        ( Nothing, Just host ) ->
            Just host

        ( Nothing, Nothing ) ->
            Nothing


{-| Operator role row (the 313 detail, else the generic word). -}
roleField : Services.WhoisInfo -> Maybe (Html Msg)
roleField current =
    if current.isOper then
        let
            label =
                case Maybe.map String.trim current.operRole of
                    Just role ->
                        if String.isEmpty role then
                            "IRC operator"

                        else
                            role

                    Nothing ->
                        "IRC operator"
        in
        Just (profileField "Role" [ span [ class "onyx-profile-oper" ] [ text label ] ])

    else
        Nothing


{-| Node row (server plus its info line when both arrive). -}
nodeField : Services.WhoisInfo -> Maybe (Html Msg)
nodeField current =
    case ( current.server, current.serverInfo ) of
        ( Nothing, Nothing ) ->
            Nothing

        ( server, serverInfo ) ->
            Just
                (profileField "Node"
                    ([ span [] [ text (Maybe.withDefault "Unknown node" server) ] ]
                        ++ (case serverInfo of
                                Just detail ->
                                    [ small [] [ text detail ] ]

                                Nothing ->
                                    []
                           )
                    )
                )


{-| Signed-on row (the UTC ISO instant; Elm has no locale date
renderer, so the oracle locale string stays a narrowing). -}
signOnField : Int -> Maybe (Html Msg)
signOnField ts =
    if ts <= 0 then
        Nothing

    else
        let
            iso =
                App.millisToIso (toFloat ts * 1000)
        in
        Just
            (profileField "Signed on"
                [ time [ datetime iso ] [ text iso ] ]
            )


{-| Shared rooms row (channel targets link to the room ledger,
like the oracle `^[#&]` gate). -}
roomsField : String -> Services.WhoisInfo -> Maybe (Html Msg)
roomsField shown current =
    if List.isEmpty current.channels then
        Nothing

    else
        Just
            (profileField "Rooms"
                [ ul
                    [ class "onyx-profile-channels"
                    , attribute "aria-label" ("Rooms shared with " ++ shown)
                    ]
                    (List.map (roomRow shown) current.channels)
                ]
            )


roomRow : String -> String -> Html Msg
roomRow _ channel =
    li []
        [ if isLedgerChannel channel then
            a
                [ href (App.statsRoomHref channel)
                , attribute "aria-label" ("Room ledger for " ++ channel)
                ]
                [ text channel ]

          else
            text channel
        ]


isLedgerChannel : String -> Bool
isLedgerChannel channel =
    case String.uncons (String.trim channel) of
        Just ( first, _ ) ->
            first == '#' || first == '&'

        Nothing ->
            False


{-| Network notes row. -}
notesField : String -> Services.WhoisInfo -> Maybe (Html Msg)
notesField shown current =
    if List.isEmpty current.specialNotes then
        Nothing

    else
        Just
            (profileField "Network notes"
                [ ul
                    [ class "onyx-profile-notes"
                    , attribute "aria-label" ("Network notes for " ++ shown)
                    ]
                    (List.map (\note -> li [] [ text note ]) current.specialNotes)
                ]
            )


{-| Whether any details row applies (mirroring the oracle
`hasDetails` gate field for field). -}
hasDetails : Services.WhoisInfo -> Bool
hasDetails current =
    current.account
        /= Nothing
        || current.realname
        /= Nothing
        || current.username
        /= Nothing
        || current.host
        /= Nothing
        || current.realHost
        /= Nothing
        || current.server
        /= Nothing
        || current.serverInfo
        /= Nothing
        || current.isOper
        || current.bot
        || current.awayMessage
        /= Nothing
        || current.secureConnection
        /= Nothing
        || current.certfp
        /= Nothing
        || current.idleSecs
        /= Nothing
        || current.signOnTs
        /= Nothing
        || not (List.isEmpty current.channels)
        || not (List.isEmpty current.specialNotes)


{-| Idle duration copy (mirroring the oracle `formatIdle`). -}
formatIdle : Int -> String
formatIdle seconds =
    let
        safe =
            max 0 seconds
    in
    if safe < 60 then
        if safe == 0 then
            "Active now"

        else
            String.fromInt safe ++ " seconds"

    else if safe < 3600 then
        String.fromInt (safe // 60) ++ " minutes"

    else if safe < 86400 then
        String.fromInt (safe // 3600) ++ " hours"

    else
        String.fromInt (safe // 86400) ++ " days"


{-| The member card for the open profile (mirroring
`PeopleProfileCard`: identity block with display name, pronouns,
away/about, guest badge, presence line, Mention / Block / Copy
name actions, and the Advanced disclosure with account, role,
network role, hostmask, copy, network profile, and ledger rows;
Message, Report, and moderation stay later slices behind their
missing backends). -}
profileCard : Model -> Html Msg
profileCard model =
    case model.userProfileCard of
        Nothing ->
            text ""

        Just card ->
            cardFor model card.nick card.channel


cardFor : Model -> String -> String -> Html Msg
cardFor model nick channel =
    let
        profile =
            App.getUserProfile model nick

        info =
            App.whoisInfoFor model nick

        member =
            Dict.get (String.toLower channel) model.channels
                |> Maybe.andThen (\room -> Dict.get (String.toLower nick) room.members)

        role =
            Modes.resolveRole
                (Maybe.map .modes member |> Maybe.withDefault Set.empty)
                model.isupport.prefixOrder
                model.isupport.modeToPrefix

        isSelf =
            String.toLower nick == String.toLower model.ourNick

        displayName =
            case Maybe.andThen .displayName profile of
                Just published ->
                    if String.isEmpty (String.trim published) then
                        nick

                    else
                        String.trim published

                Nothing ->
                    nick

        pronouns =
            Maybe.andThen .pronouns profile
                |> Maybe.map String.trim
                |> Maybe.andThen
                    (\value ->
                        if String.isEmpty value then
                            Nothing

                        else
                            Just value
                    )

        about =
            Maybe.andThen .bio profile
                |> Maybe.map String.trim
                |> Maybe.andThen
                    (\value ->
                        if String.isEmpty value then
                            Nothing

                        else
                            Just value
                    )

        away =
            Maybe.map .away member |> Maybe.withDefault False

        account =
            case Maybe.andThen .account profile of
                Just stored ->
                    if String.isEmpty (String.trim stored) then
                        Maybe.andThen .account info

                    else
                        Just (String.trim stored)

                Nothing ->
                    Maybe.andThen .account info

        cardId =
            "people-card-" ++ slug nick ++ "-" ++ slug channel

        described =
            case ( about, away, pronouns ) of
                ( Just _, _, _ ) ->
                    Just (cardId ++ "-about")

                ( Nothing, True, _ ) ->
                    Just (cardId ++ "-status")

                ( Nothing, False, Just _ ) ->
                    Just (cardId ++ "-pronouns")

                _ ->
                    Nothing

        ignored =
            Set.member (String.toLower (String.trim nick)) model.ignoredUsers
    in
    div [ class "onyx-profile-pop" ]
        [ div
            [ class "onyx-profile-backdrop"
            , onClick App.UserProfileClosed
            ]
            []
        , div
            ([ class "onyx-member-card"
             , attribute "role" "region"
             , attribute "aria-labelledby" (cardId ++ "-name")
             , on "keydown" cardEscapeDecoder
             ]
                ++ (case described of
                        Just target ->
                            [ attribute "aria-describedby" target ]

                        Nothing ->
                            []
                   )
            )
            [ div [ class "onyx-member-identity" ]
                [ span [ class "onyx-member-avatar", attribute "aria-hidden" "true" ]
                    [ text (avatarInitial displayName) ]
                , div [ class "onyx-member-copy" ]
                    ([ p [ class "onyx-member-name", attribute "id" (cardId ++ "-name") ] [ text displayName ] ]
                        ++ (if String.toLower displayName /= String.toLower nick then
                                [ p [ class "onyx-member-nickline" ] [ text nick ] ]

                            else
                                []
                           )
                        ++ (case pronouns of
                                Just value ->
                                    [ p [ class "onyx-member-pronouns", attribute "id" (cardId ++ "-pronouns") ] [ text value ] ]

                                Nothing ->
                                    []
                           )
                        ++ (if away then
                                [ p [ class "onyx-member-status", attribute "id" (cardId ++ "-status") ] [ text "Away" ] ]

                            else
                                []
                           )
                        ++ (case about of
                                Just value ->
                                    [ p [ class "onyx-member-about", attribute "id" (cardId ++ "-about") ] [ text value ] ]

                                Nothing ->
                                    []
                           )
                        ++ (if not isSelf && account == Nothing then
                                [ p [ class "onyx-member-guest" ] [ text "Guest" ] ]

                            else
                                []
                           )
                    )
                ]
            , div
                [ class "onyx-member-presence"
                , attribute "aria-label" (role.label ++ (if away then ", away" else ""))
                ]
                [ span [ class "onyx-member-dot", attribute "aria-hidden" "true" ] []
                , span [] [ text role.label ]
                ]
            , if isSelf then
                text ""

              else
                div
                    [ class "onyx-member-actions"
                    , attribute "role" "group"
                    , attribute "aria-label" ("Actions for " ++ nick)
                    ]
                    [ button
                        [ attribute "type" "button"
                        , class "onyx-member-action"
                        , attribute "aria-label" ("Mention " ++ nick ++ " in the composer")
                        , onClick (App.MemberMention { nick = nick, channel = channel })
                        ]
                        [ text "Mention" ]
                    , if ignored then
                        button
                            [ attribute "type" "button"
                            , class "onyx-member-action"
                            , attribute "aria-label" ("Unblock " ++ nick ++ " on this device")
                            , onClick (App.UnignoreUser (String.trim nick))
                            ]
                            [ text "Unblock" ]

                      else
                        button
                            [ attribute "type" "button"
                            , class "onyx-member-action"
                            , attribute "aria-label" ("Block " ++ nick ++ " on this device")
                            , onClick (App.IgnoreUser (String.trim nick))
                            ]
                            [ text "Block" ]
                    , button
                        [ attribute "type" "button"
                        , class "onyx-member-action"
                        , attribute "aria-label" ("Close profile for " ++ nick)
                        , onClick App.UserProfileClosed
                        ]
                        [ text "Close" ]
                    ]
            , details [ class "onyx-member-advanced" ]
                (summary [ class "onyx-member-advanced-toggle" ] [ text "Room and network details" ]
                    :: advancedRows nick channel role account info
                )
            , moderationControls model nick channel member isSelf
            ]
        ]


{-| Advanced disclosure rows: account, room role, network role,
hostmask, then copy / network-profile / ledger actions. -}
advancedRows : String -> String -> Modes.ResolvedRole -> Maybe String -> Maybe Services.WhoisInfo -> List (Html Msg)
advancedRows nick channel role account info =
    let
        trimmedChannel =
            String.trim channel

        hostmask =
            case info of
                Just current ->
                    case whoisIdentity current of
                        Just identity ->
                            Just identity

                        Nothing ->
                            current.realHost

                Nothing ->
                    Nothing

        networkRole =
            case info of
                Just current ->
                    if current.isOper then
                        Just
                            (case Maybe.map String.trim current.operRole of
                                Just detail ->
                                    if String.isEmpty detail then
                                        "IRC operator"

                                    else
                                        detail

                                Nothing ->
                                    "IRC operator"
                            )

                    else
                        Nothing

                Nothing ->
                    Nothing
    in
    (case account of
        Just value ->
            [ p [ class "onyx-member-meta" ] [ text ("Account " ++ value) ] ]

        Nothing ->
            []
    )
        ++ (if String.isEmpty trimmedChannel then
                []

            else
                [ p [ class "onyx-member-meta" ] [ text (role.label ++ " in " ++ trimmedChannel) ] ]
           )
        ++ (case networkRole of
                Just value ->
                    [ p [ class "onyx-member-meta" ] [ text (value ++ " on this network") ] ]

                Nothing ->
                    []
           )
        ++ (case hostmask of
                Just value ->
                    [ p [ class "onyx-member-hostmask" ] [ text value ] ]

                Nothing ->
                    []
           )
        ++ [ div
                [ class "onyx-member-advanced-actions"
                , attribute "role" "group"
                , attribute "aria-label" ("Details actions for " ++ nick)
                ]
                [ button
                    [ attribute "type" "button"
                    , class "onyx-member-action"
                    , attribute "aria-label" ("Copy name " ++ nick)
                    , onClick (App.MemberCopyNick nick)
                    ]
                    [ text "Copy name" ]
                , button
                    [ attribute "type" "button"
                    , class "onyx-member-action"
                    , attribute "aria-label" ("View profile of " ++ nick)
                    , onClick (App.MemberCardWhois nick)
                    ]
                    [ text "Network profile" ]
                , if isLedgerChannel trimmedChannel then
                    a
                        [ class "onyx-member-ledger"
                        , href (App.statsRoomHref trimmedChannel)
                        , attribute "aria-label" ("Room ledger for " ++ trimmedChannel)
                        ]
                        [ text "Room ledger" ]

                  else
                    text ""
                ]
           ]


{-| URL-safe id slug (mirroring the oracle card-id cleanup). -}
slug : String -> String
slug value =
    String.toLower value
        |> String.toList
        |> List.map
            (\char ->
                if Char.isAlphaNum char || char == '-' || char == '_' then
                    char

                else
                    '-'
            )
        |> String.fromList
        |> String.trim


{-| Decorative avatar initial. -}
avatarInitial : String -> String
avatarInitial name =
    case String.uncons (String.trim name) of
        Just ( first, _ ) ->
            String.fromChar (Char.toUpper first)

        Nothing ->
            "?"


{-| Escape dismisses the member card (same IME-yielding shape
as the sheet decoder). -}
cardEscapeDecoder : Decode.Decoder Msg
cardEscapeDecoder =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.field "key" Decode.string
                        |> Decode.andThen
                            (\key ->
                                if key == "Escape" then
                                    Decode.succeed App.UserProfileClosed

                                else
                                    Decode.fail "not-escape"
                            )
            )


{-| Escape dismisses the sheet (same IME-yielding shape as the
menu and picker decoders). -}
profileEscapeDecoder : Decode.Decoder Msg
profileEscapeDecoder =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.field "key" Decode.string
                        |> Decode.andThen
                            (\key ->
                                if key == "Escape" then
                                    Decode.succeed App.WhoisClose

                                else
                                    Decode.fail "not-escape"
                            )
            )


{-| Card moderation controls (mirroring the oracle `showRoomModeration`
/ `showIrcRoleControls` gates: room op, not self, and the experience
mode publishing kick (room actions) or op (role controls)). -}
moderationControls : Model -> String -> String -> Maybe App.Member -> Bool -> Html Msg
moderationControls model nick channel member isSelf =
    let
        kinds =
            Moderation.kindsForMode (Prefs.experienceModeToString model.prefs.experienceMode)

        canModerate =
            App.isChannelOp model channel

        modes =
            Maybe.map .modes member |> Maybe.withDefault Set.empty

        propose kind =
            App.ModerationPropose { kind = kind, channel = channel, target = nick }
    in
    if not canModerate || isSelf then
        text ""

    else if not (List.member Moderation.Kick kinds) then
        text ""

    else
        div
            [ class "onyx-member-mod"
            , attribute "role" "group"
            , attribute "aria-label" ("Moderate " ++ nick)
            ]
            ([]
                ++ (if List.member Moderation.Op kinds then
                        [ if Set.member 'o' modes then
                            modButton ("Remove op from " ++ nick) "Deop" (propose Moderation.Deop)

                          else
                            modButton ("Give op to " ++ nick) "Op" (propose Moderation.Op)
                        , if Set.member 'v' modes then
                            modButton ("Remove voice from " ++ nick) "Devoice" (propose Moderation.Devoice)

                          else
                            modButton ("Give voice to " ++ nick) "Voice" (propose Moderation.Voice)
                        ]

                    else
                        []
                   )
                ++ [ modButton ("Kick " ++ nick ++ " from " ++ channel) "Kick" (propose Moderation.Kick)
                   , modButton ("Ban " ++ nick ++ " from " ++ channel) "Ban" (propose Moderation.Ban)
                   ]
            )


{-| One moderation control button. -}
modButton : String -> String -> Msg -> Html Msg
modButton label visible msg =
    button
        [ attribute "type" "button"
        , class "onyx-member-action"
        , attribute "aria-label" label
        , onClick msg
        ]
        [ text visible ]


{-| Review-first confirmation for a staged draft (mirroring
`ModerationActionReview`: nothing sends until the labelled confirm
control is used, and confirm invalidates on disconnect or lost
room authority). -}
moderationReview : Model -> Html Msg
moderationReview model =
    case model.moderationDraft of
        Nothing ->
            text ""

        Just draft ->
            let
                validation =
                    Moderation.validateDraft draft model.ourNick

                review =
                    case validation of
                        Ok valid ->
                            Just valid.review

                        Err _ ->
                            Nothing

                errors =
                    case validation of
                        Ok _ ->
                            []

                        Err problems ->
                            problems

                connected =
                    model.connection == App.Live

                canModerate =
                    App.isChannelOp model draft.channel

                blockedReason =
                    if not connected then
                        Just "Reconnect to send this change. Your draft stays on this device."

                    else if not canModerate then
                        Just "You no longer have moderator permission in this room."

                    else
                        Nothing

                canSend =
                    review /= Nothing && blockedReason == Nothing

                title =
                    Maybe.map .title review |> Maybe.withDefault "Review room action"

                describedBy =
                    case ( blockedReason, review ) of
                        ( Just _, _ ) ->
                            "moderation-review-status"

                        ( Nothing, Nothing ) ->
                            "moderation-review-errors"

                        ( Nothing, Just _ ) ->
                            ""
            in
            div [ class "onyx-profile-pop" ]
                [ div
                    [ class "onyx-profile-backdrop"
                    , onClick App.ModerationCancel
                    ]
                    []
                , div
                    [ class "onyx-moderation-review"
                    , attribute "role" "dialog"
                    , attribute "aria-label" title
                    , attribute "aria-describedby" "moderation-review-desc"
                    , on "keydown" reviewEscapeDecoder
                    ]
                    [ h2 [ class "onyx-moderation-title" ] [ text title ]
                    , p [ class "onyx-moderation-desc", attribute "id" "moderation-review-desc" ]
                        [ text "Nothing is sent until you confirm." ]
                    , case review of
                        Just copy ->
                            div []
                                [ dl [ class "onyx-moderation-facts" ]
                                    [ div [ class "onyx-profile-field" ]
                                        [ dt [] [ text "Permission" ]
                                        , dd [] [ text (if canModerate then "Room moderator" else "Not available") ]
                                        ]
                                    , div [ class "onyx-profile-field" ]
                                        [ dt [] [ text "Target scope" ]
                                        , dd [] [ text draft.channel ]
                                        ]
                                    , div [ class "onyx-profile-field" ]
                                        [ dt [] [ text "Receipt" ]
                                        , dd [] [ text "Local draft until confirmed; server echo is the source of truth." ]
                                        ]
                                    ]
                                , p [ class "onyx-moderation-summary" ] [ text copy.summary ]
                                , p [ class "onyx-moderation-impact" ] [ text copy.impact ]
                                ]

                        Nothing ->
                            ul
                                [ attribute "id" "moderation-review-errors"
                                , class "onyx-moderation-errors"
                                , attribute "role" "alert"
                                ]
                                (List.map (\problem -> li [] [ text problem ]) errors)
                    , case blockedReason of
                        Just reason ->
                            p
                                [ attribute "id" "moderation-review-status"
                                , class "onyx-moderation-status"
                                , attribute "role" "status"
                                ]
                                [ text reason ]

                        Nothing ->
                            text ""
                    , div [ class "onyx-moderation-actions" ]
                        [ button
                            [ attribute "type" "button"
                            , class "onyx-member-action"
                            , attribute "aria-label" "Cancel room action"
                            , onClick App.ModerationCancel
                            ]
                            [ text "Cancel" ]
                        , button
                            ([ attribute "type" "button"
                             , class "onyx-member-action onyx-member-confirm"
                             , onClick App.ModerationConfirm
                             , disabled (not canSend)
                             ]
                                ++ (if String.isEmpty describedBy then
                                        []

                                    else
                                        [ attribute "aria-describedby" describedBy ]
                                   )
                            )
                            [ text (Maybe.map .confirmLabel review |> Maybe.withDefault "Confirm") ]
                        ]
                    ]
                ]


{-| Escape cancels the review (same IME-yielding shape as the
other decoders). -}
reviewEscapeDecoder : Decode.Decoder Msg
reviewEscapeDecoder =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.field "key" Decode.string
                        |> Decode.andThen
                            (\key ->
                                if key == "Escape" then
                                    Decode.succeed App.ModerationCancel

                                else
                                    Decode.fail "not-escape"
                            )
            )
