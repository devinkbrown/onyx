module View.Trust exposing (TrustPage(..), houseRules, pageTitle, route, trustPageForRoute, trustPageForPath, view)

{-| Trust pages, mirroring `src/routes/TrustPages.tsx`: Privacy,
Guidelines (house rules), and Contact share one meta table and one
layout. Paths resolve through the allowlist (slashless aliases work
the same way); anything else is `Nothing` and the caller renders the
route terminus instead — fail-closed where the oracle throws.

Unlike the info pages these carry no frame `context` line.
-}

import App exposing (Model, Msg)
import Html exposing (Html, a, article, div, h1, h2, li, ol, p, section, text)
import Html.Attributes exposing (attribute, class, href, id, rel, target)
import Route exposing (Route)
import View.PublicFrame exposing (frame)


{-| The three trust pages. -}
type TrustPage
    = Privacy
    | Guidelines
    | Contact


{-| Page key, mirroring the `TRUST_PATHS` values. -}
pageKey : TrustPage -> String
pageKey page =
    case page of
        Privacy ->
            "privacy"

        Guidelines ->
            "guidelines"

        Contact ->
            "contact"


{-| Resolve a trust page from an allowlisted path (trailing-slash and
slashless forms both resolve; anything else is `Nothing`). -}
trustPageForPath : String -> Maybe TrustPage
trustPageForPath path =
    case path of
        "/privacy" ->
            Just Privacy

        "/privacy/" ->
            Just Privacy

        "/guidelines" ->
            Just Guidelines

        "/guidelines/" ->
            Just Guidelines

        "/contact" ->
            Just Contact

        "/contact/" ->
            Just Contact

        _ ->
            Nothing


{-| Dispatch helper: route → trust page, if any. -}
trustPageForRoute : Route -> Maybe TrustPage
trustPageForRoute route_ =
    case route_ of
        Route.Privacy ->
            Just Privacy

        Route.Guidelines ->
            Just Guidelines

        Route.Contact ->
            Just Contact

        _ ->
            Nothing


{-| Page metadata, mirroring `TRUST_PAGE_META`. -}
type alias TrustMeta =
    { title : String
    , heading : String
    , kicker : String
    , mainLabel : String
    , lede : String
    }


trustMeta : TrustPage -> TrustMeta
trustMeta page =
    case page of
        Privacy ->
            { title = "Onyx privacy — what stays here"
            , heading = "What we actually keep"
            , kicker = "Privacy"
            , mainLabel = "Onyx privacy"
            , lede = "Facts only. Not a terms of service."
            }

        Guidelines ->
            { title = "Onyx house rules"
            , heading = "House rules"
            , kicker = "Guidelines"
            , mainLabel = "Onyx house rules"
            , lede = "A short list. Rooms can be stricter."
            }

        Contact ->
            { title = "Onyx contact"
            , heading = "Contact"
            , kicker = "Contact"
            , mainLabel = "Onyx contact"
            , lede = "GitHub is the public door. There is no report email in this repository."
            }


{-| Document title, mirroring the `setPageMeta` call. -}
pageTitle : TrustPage -> String
pageTitle page =
    (trustMeta page).title


{-| The house rules, mirroring `HOUSE_RULES` verbatim. -}
houseRules : List String
houseRules =
    [ "Be kind. Argue about ideas, not people."
    , "Welcome people who just arrived."
    , "Do not harass, threaten, or stalk anyone."
    , "Do not share someone else’s private information."
    , "Do not spam rooms or DMs."
    , "A room can be stricter than this list."
    , "If a room is not for you, leave."
    , "Do not impersonate people or this project."
    , "Keep illegal content out of the rooms."
    , "Onyx is not 911. If someone is in danger, contact local emergency services."
    , "Report harm in the room, or open a GitHub issue that does not include exploit details."
    , "We can disable accounts or rooms that break these rules."
    ]


guidelinesArticle : Html Msg
guidelinesArticle =
    article [ class "data-card public-info-card trust-article" ]
        [ h2 [ class "trust-article-heading", id "trust-guidelines-body-heading" ] [ text "Rooms" ]
        , ol [ class "trust-rules" ] (List.map (\rule -> li [] [ text rule ]) houseRules)
        , p []
            [ text "Report a security issue through GitHub’s private vulnerability reporting on this repository, as "
            , a [ href "https://github.com/devinkbrown/onyx/blob/onyx-solid/SECURITY.md" ] [ text "SECURITY.md" ]
            , text " describes. There is no public report mailbox in this source tree."
            ]
        ]


privacyArticle : Html Msg
privacyArticle =
    article [ class "data-card public-info-card trust-article" ]
        [ h2 [ class "trust-article-heading", id "trust-privacy-body-heading" ] [ text "This device and the server" ]
        , p []
            [ text "If you register, the server stores the account name and the email you give it. Room messages stay with the room so it can stay open. Group rooms are not end-to-end encrypted. Group E2EE is not live." ]
        , p []
            [ text "Private DMs are sealed on this device. If a DM cannot open, it stays locked. This page does not claim every class of message is unreadable to the operator." ]
        , p []
            [ text "DM encryption covers encrypted message text and its wire payload. Plaintext local drafts and attachments are separate device data and are not covered by that message-encryption claim." ]
        , p []
            [ text "This browser keeps about 400 recent messages per room on this device. Older lines are pruned here." ]
        , p []
            [ text "Passkeys exist only when the server turns them on. They are not the everyday anonymous door." ]
        , p []
            [ text "This site loads no ads, does not sell your attention, and does not load third-party analytics pixels." ]
        , p []
            [ text "Questions: "
            , a [ href "/contact/" ] [ text "Contact" ]
            , text "."
            ]
        ]


contactArticle : Html Msg
contactArticle =
    article [ class "data-card public-info-card trust-article" ]
        [ h2 [ class "trust-article-heading", id "trust-contact-body-heading" ] [ text "How to reach us" ]
        , p []
            [ text "Ordinary product questions belong on GitHub issues for "
            , a [ href "https://github.com/devinkbrown/onyx", rel "noreferrer noopener", target "_blank" ] [ text "devinkbrown/onyx" ]
            , text "."
            ]
        , p []
            [ text "Security reports follow "
            , a [ href "https://github.com/devinkbrown/onyx/blob/onyx-solid/SECURITY.md" ] [ text "SECURITY.md" ]
            , text ": use private vulnerability reporting when it is available, or open a minimal public issue that says a private contact is needed — without exploit details, payloads, or user data."
            ]
        , p []
            [ text "There is no contact email checked into this repository, so this page does not publish one." ]
        ]


{-| The trust-page body. -}
view : TrustPage -> Html Msg
view page =
    let
        meta =
            trustMeta page

        key =
            pageKey page

        body =
            case page of
                Privacy ->
                    privacyArticle

                Guidelines ->
                    guidelinesArticle

                Contact ->
                    contactArticle
    in
    div [ class ("ui-root r data-page public-info-page trust-page trust-page--" ++ key) ]
        [ div [ class "r-ground", attribute "aria-hidden" "true" ] []
        , section [ class "r-wrap data-hero trust-hero", attribute "aria-labelledby" ("trust-" ++ key ++ "-heading") ]
            [ p [ class "r-kicker" ] [ text meta.kicker ]
            , h1 [ id ("trust-" ++ key ++ "-heading") ] [ text meta.heading ]
            , p [ class "sub" ] [ text meta.lede ]
            ]
        , section [ class "r-wrap r-section trust-reading", attribute "aria-labelledby" ("trust-" ++ key ++ "-body-heading") ]
            [ body ]
        ]


{-| The trust-page route inside the public frame (no context line). -}
route : Model -> TrustPage -> List (Html Msg)
route model page =
    [ frame model ("/" ++ pageKey page ++ "/") (trustMeta page).mainLabel Nothing [ view page ] ]
