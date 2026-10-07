module Route exposing
    ( Route(..)
    , fromUrl
    , toPath
    )

{-| Application routes — Elm port of the `@solidjs/router` table in
`src/index.tsx` (`/`, `/about`, `/app`, `/appearance`, `/stats`,
`/status`, `/roadmap`, `/invite`, `/guides`, `/community`, `/privacy`,
`/guidelines`, `/contact`, `/accessibility`, `/glossary`, `/integrations`,
`/agents`).

Kept in sync with `ROUTE_ENTRYPOINTS` in
`tools/materialize-route-entrypoints.mjs` the same way the TS table is.
-}

import Url exposing (Url)
import Url.Parser as Parser exposing ((</>), Parser, map, oneOf, s, top)


type Route
    = Landing
    | About
    | App
    | Appearance
    | Stats
    | Status
    | Roadmap
    | Invite
    | Guides
    | Community
    | Privacy
    | Guidelines
    | Contact
    | Accessibility
    | Glossary
    | Integrations
    | Agents
    | Onyxos
    | Download
    | NotFound


parser : Parser (Route -> a) a
parser =
    oneOf
        [ map Landing top
        , map About (s "about")
        , map App (s "app")
        , map Appearance (s "appearance")
        , map Stats (s "stats")
        , map Status (s "status")
        , map Roadmap (s "roadmap")
        , map Invite (s "invite")
        , map Guides (s "guides")
        , map Community (s "community")
        , map Privacy (s "privacy")
        , map Guidelines (s "guidelines")
        , map Contact (s "contact")
        , map Accessibility (s "accessibility")
        , map Glossary (s "glossary")
        , map Integrations (s "integrations")
        , map Agents (s "agents")
        , map Onyxos (s "onyxos")
        , map Download (s "download")
        , map Download (s "install")
        ]


fromUrl : Url -> Route
fromUrl url =
    Maybe.withDefault NotFound (Parser.parse parser url)


toPath : Route -> String
toPath route =
    case route of
        Landing ->
            "/"

        About ->
            "/about"

        App ->
            "/app"

        Appearance ->
            "/appearance"

        Stats ->
            "/stats"

        Status ->
            "/status"

        Roadmap ->
            "/roadmap"

        Invite ->
            "/invite"

        Guides ->
            "/guides"

        Community ->
            "/community"

        Privacy ->
            "/privacy"

        Guidelines ->
            "/guidelines"

        Contact ->
            "/contact"

        Accessibility ->
            "/accessibility"

        Glossary ->
            "/glossary"

        Integrations ->
            "/integrations"

        Agents ->
            "/agents"

        Onyxos ->
            "/onyxos"

        Download ->
            "/download"

        NotFound ->
            "/"
