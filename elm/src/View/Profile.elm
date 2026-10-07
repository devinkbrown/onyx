module View.Profile exposing (profileSheet)

{-| Member network-identity sheet (mirroring `WhoisSheet`: a thin
reactive view over the folded WHOIS cache — title, description,
summary, live status, and the details list; the sheet opens through
`WhoisRequest` and closes through `WhoisClose`). -}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, code, dd, div, dl, dt, h2, li, p, small, span, text, time, ul)
import Html.Attributes exposing (attribute, class, datetime, href)
import Html.Events exposing (on, onClick)
import Json.Decode as Decode
import Services


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
