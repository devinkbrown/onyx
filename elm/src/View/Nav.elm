module View.Nav exposing (attention, mobileNav, primaryNav, youDialog)

{-| Shell primary navigation and the You dialog.

Ported from the v3 client (`claude/elm-port-fix-f381d5:elm/src/View/Nav.elm`).
One `Nav.items` model renders twice: a 56px icon rail (`Primary`
landmark, labels on hover / keyboard focus) and a bottom bar under
768px (`Mobile navigation`, labels under the icons). Both are always in
the DOM; CSS shows one per width. The current location carries
`aria-current="page"`; You carries `aria-haspopup="dialog"` and
`aria-expanded`, and on phones a collection says whether its page is
open.

Adapted to today's shell: the v3 You hub listed many v3-only sheets;
here the You dialog gathers the identity facts and doors the old
identity chip and connection pill already led to (reclaim, account,
keep this name, connection, appearance, guides). Every door closes the
dialog first (`YouThen`), and the ports focus manager hands focus back
to the You button when the next dialog closes.

-}

import App exposing (Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, a, button, div, h2, nav, p, small, span, strong, text)
import Html.Attributes exposing (attribute, class, classList, href, id, type_)
import Html.Events exposing (onClick)
import Nav


{-| Collection totals for the nav items: how many conversations have
something new, and whether any of them mentions you. -}
attention : Model -> Nav.Id -> { count : Int, mention : Bool }
attention model id =
    let
        inCollection channel =
            case id of
                Nav.Rooms ->
                    App.isChannelName model channel.name

                Nav.Messages ->
                    not (App.isChannelName model channel.name)

                _ ->
                    False

        waiting =
            model.channels
                |> Dict.values
                |> List.filter (\c -> inCollection c && (c.unread > 0 || c.highlights > 0))
    in
    { count = List.length waiting, mention = List.any (\c -> c.highlights > 0) waiting }


attentionSuffix : { count : Int, mention : Bool } -> String
attentionSuffix att =
    if att.count == 0 then
        ""

    else
        ", "
            ++ String.fromInt att.count
            ++ " unread"
            ++ (if att.mention then
                    ", with mentions"

                else
                    ""
               )


navItems : Nav.Variant -> Model -> List Nav.Item
navItems variant model =
    Nav.items
        { variant = variant
        , current = model.navSection
        , collectionOpen = model.clientRoomsOpen
        , youOpen = model.youOpen
        }


primaryNav : Model -> Html Msg
primaryNav model =
    nav
        [ class "onyx-primary-nav"
        , attribute "aria-label" "Primary"
        , attribute "data-primary-navigation" "desktop"
        ]
        [ span [ class "onyx-primary-nav-mark", attribute "aria-hidden" "true" ] [ span [ class "onyx-gem" ] [] ]
        , div [ class "onyx-primary-nav-items" ]
            (List.map (navButton model Nav.Desktop) (navItems Nav.Desktop model))
        ]


mobileNav : Model -> Html Msg
mobileNav model =
    nav
        [ class "onyx-mobile-nav"
        , attribute "aria-label" "Mobile navigation"
        , attribute "data-primary-navigation" "mobile"
        ]
        (List.map (navButton model Nav.Mobile) (navItems Nav.Mobile model))


boolAttr : String -> Bool -> Html.Attribute msg
boolAttr name on =
    attribute name
        (if on then
            "true"

         else
            "false"
        )


navButton : Model -> Nav.Variant -> Nav.Item -> Html Msg
navButton model variant item =
    let
        att =
            attention model item.id

        youLabel =
            if item.id == Nav.You then
                ", " ++ String.trim model.ourNick

            else
                ""

        optional =
            List.filterMap identity
                [ if item.current then
                    Just (attribute "aria-current" "page")

                  else
                    Nothing
                , Maybe.map (boolAttr "aria-expanded") item.expanded
                , Maybe.map (attribute "aria-haspopup") item.hasPopup
                , if item.id == Nav.You then
                    Just (attribute "aria-controls" "you-dialog")

                  else
                    Nothing
                ]
    in
    button
        ([ type_ "button"
         , classList
            [ ( "onyx-nav-btn", True )
            , ( "onyx-nav-btn--active", item.current )
            , ( "onyx-nav-btn--open", item.expanded == Just True && item.id == Nav.You )
            ]
         , attribute "data-section" (Nav.idKey item.id)
         , attribute "data-testid" ("nav-" ++ Nav.idKey item.id)
         , onClick (NavSelect item.id)
         ]
            ++ optional
        )
        [ span [ class "onyx-nav-glyph", attribute "aria-hidden" "true" ]
            [ if item.id == Nav.You then
                span [ class "onyx-nav-face" ] [ text (Avatar.initials model.ourNick) ]

              else
                span [ class "onyx-nav-icon", attribute "data-icon" (Nav.idKey item.id) ] []
            , if att.count > 0 then
                span
                    [ classList [ ( "onyx-nav-badge", True ), ( "onyx-nav-badge--mention", att.mention ) ] ]
                    [ text
                        (if att.mention then
                            "@"

                         else if att.count > 9 then
                            "9+"

                         else
                            String.fromInt att.count
                        )
                    ]

              else
                text ""
            ]
        , span
            [ class "onyx-nav-label"
            , attribute "data-variant"
                (if variant == Nav.Mobile then
                    "mobile"

                 else
                    "desktop"
                )
            ]
            [ text item.label
            , span [ class "sr-only" ] [ text (attentionSuffix att ++ youLabel) ]
            ]
        ]



-- YOU


youDialog : Model -> Html Msg
youDialog model =
    if not model.youOpen then
        text ""

    else
        let
            nick =
                String.trim model.ourNick

            guest =
                model.accountName == Nothing

            ( connKey, connWords ) =
                case model.connection of
                    App.Live ->
                        ( "live", "Connected to Onyx" )

                    App.Registering ->
                        ( "connecting", "Connecting…" )

                    App.Offline ->
                        ( "offline", "Offline — your history and drafts stay here" )
        in
        div [ class "onyx-you-veil" ]
            [ div
                [ class "onyx-you"
                , id "you-dialog"
                , attribute "role" "dialog"
                , attribute "aria-modal" "true"
                , attribute "aria-labelledby" "you-title"
                , attribute "data-testid" "you-dialog"
                , attribute "data-guest" (if guest then "true" else "false")
                ]
                [ div [ class "onyx-you-head" ]
                    [ h2 [ id "you-title" ] [ text "You" ]
                    , button
                        [ type_ "button"
                        , class "onyx-you-close"
                        , attribute "aria-label" "Close You"
                        , onClick YouClose
                        ]
                        [ text "Close" ]
                    ]
                , div [ class "onyx-you-identity" ]
                    [ span [ class "onyx-you-face", attribute "aria-hidden" "true" ] [ text (Avatar.initials nick) ]
                    , div [ class "onyx-you-facts" ]
                        [ p [ class "onyx-you-nick", attribute "data-testid" "you-nick" ]
                            [ text
                                (if String.isEmpty nick then
                                    "No name yet"

                                 else
                                    nick
                                )
                            , if model.currentNickIsAlias then
                                span [ class "onyx-ident-badge" ] [ text "alias" ]

                              else
                                text ""
                            ]
                        , p [ class "onyx-you-desc" ]
                            [ text
                                (case model.accountName of
                                    Just account ->
                                        "Signed in as " ++ account ++ "."

                                    Nothing ->
                                        if App.isGuestNick model.ourNick then
                                            "Guest name — sign in or keep a name to protect it."

                                        else
                                            "Guest — this name is not protected yet."
                                )
                            ]
                        , p [ class "onyx-you-conn", attribute "data-state" connKey, attribute "role" "status" ]
                            [ span [ class "onyx-you-conn-dot", attribute "aria-hidden" "true" ] []
                            , text connWords
                            ]
                        ]
                    ]
                , nav [ class "onyx-you-doors", attribute "aria-label" "You settings" ]
                    (List.filterMap identity
                        [ App.reclaimTarget model
                            |> Maybe.map
                                (\target ->
                                    door "you-reclaim" True ("Take back " ++ target) "Sign in to reclaim the name held elsewhere" (YouThen ReclaimOpen)
                                )
                        , if guest then
                            Just (door "you-keep-name" True "Keep this name" "Create an account without reconnecting" YouKeepName)

                          else
                            Just (door "account-open" True "Account settings" "Identity, protection, and account data" (YouThen (SetAccountOpen True)))
                        , Just
                            (door "you-connection"
                                True
                                (if guest then
                                    "Sign in or change name"

                                 else
                                    "Connection"
                                )
                                "Status, reconnect, and your chat name"
                                (YouThen ConnectionDialogOpen)
                            )
                        , Just (link "you-appearance" "/appearance" "Appearance" "Theme, text size, and motion")
                        , Just (link "you-guides" "/guides" "Guides" "How Onyx works, step by step")
                        ]
                    )
                ]
            ]


door : String -> Bool -> String -> String -> Msg -> Html Msg
door testId popup title hint msg =
    button
        ([ type_ "button"
         , class "onyx-you-door"
         , attribute "data-testid" testId
         , onClick msg
         ]
            ++ (if popup then
                    [ attribute "aria-haspopup" "dialog" ]

                else
                    []
               )
        )
        [ strong [] [ text title ], small [] [ text hint ] ]


link : String -> String -> String -> String -> Html Msg
link testId path title hint =
    a [ class "onyx-you-door", href path, attribute "data-testid" testId, onClick YouClose ]
        [ strong [] [ text title ], small [] [ text hint ] ]
