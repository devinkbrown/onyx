module RouteTest exposing (suite)

{-| Route table coverage: every SPA entrypoint from `src/index.tsx`
resolves and round-trips to its path.
-}

import Expect
import Route exposing (..)
import Test exposing (Test, describe, test)
import Url


parse : String -> Route
parse path =
    fromUrl
        { protocol = Url.Http
        , host = "localhost"
        , port_ = Nothing
        , path = path
        , query = Nothing
        , fragment = Nothing
        }


suite : Test
suite =
    describe "Route"
        [ test "landing resolves at /" <|
            \_ -> Expect.equal Landing (parse "/")
        , test "every entrypoint resolves and round-trips" <|
            \_ ->
                Expect.equal
                    [ "/about"
                    , "/app"
                    , "/appearance"
                    , "/stats"
                    , "/status"
                    , "/roadmap"
                    , "/invite"
                    , "/guides"
                    , "/community"
                    , "/privacy"
                    , "/guidelines"
                    , "/contact"
                    , "/accessibility"
                    , "/glossary"
                    , "/integrations"
                    , "/agents"
                    , "/onyxos"
                    , "/download"
                    ]
                    (List.map (\p -> toPath (parse p))
                        [ "/about"
                        , "/app"
                        , "/appearance"
                        , "/stats"
                        , "/status"
                        , "/roadmap"
                        , "/invite"
                        , "/guides"
                        , "/community"
                        , "/privacy"
                        , "/guidelines"
                        , "/contact"
                        , "/accessibility"
                        , "/glossary"
                        , "/integrations"
                        , "/agents"
                        , "/onyxos"
                        , "/download"
                        ]
                    )
        , test "the /install alias serves the download page" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Download (parse "/install")
                    , \_ -> Expect.equal Download (parse "/install/")
                    , \_ -> Expect.equal "/download" (toPath (parse "/install"))
                    ]
                    ()
        , test "unknown paths fall back to NotFound" <|
            \_ -> Expect.equal NotFound (parse "/nope")
        ]
