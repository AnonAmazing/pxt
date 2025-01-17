import * as React from "react";
import * as sui from "./sui";
import * as core from "./core";
import * as cloudsync from "./cloudsync";
import * as dialogs from "./dialogs";
import * as workspace from "./workspace";

export const PROVIDER_NAME = "github";

export class GithubProvider extends cloudsync.ProviderBase {
    constructor() {
        super(PROVIDER_NAME, lf("GitHub"), "icon github", "https://api.github.com");
    }

    logout() {
        pxt.github.token = undefined;
        super.logout();
    }

    hasSync(): boolean {
        return false;
    }

    loginCheck() {
        super.loginCheck();

        // update github in-memory token
        const tok = this.token();
        pxt.github.token = tok;
    }

    loginAsync(redirect?: boolean, silent?: boolean): Promise<cloudsync.ProviderLoginResponse> {
        this.loginCheck()
        let p = Promise.resolve();
        if (!this.token()) {
            // auth flow
            const cl = pxt.appTarget && pxt.appTarget.cloud && pxt.appTarget.cloud.cloudProviders && pxt.appTarget.cloud.cloudProviders[this.name];
            if (cl)
                p = p.then(() => this.oauthLoginAsync());
            else
                p = p.then(() => this.showGithubLoginAsync());
        }
        return p.then(() => { return { accessToken: this.token() } as cloudsync.ProviderLoginResponse; });

    }

    private oauthLoginAsync(): Promise<void> {
        core.showLoading("ghlogin", lf("Logging you in to GitHub..."))
        const self = window.location.href.replace(/#.*/, "")
        const state = ts.pxtc.Util.guidGen();
        pxt.storage.setLocal("oauthState", state)
        pxt.storage.setLocal("oauthType", this.name)
        const login = pxt.Cloud.getServiceUrl() +
            "/oauth/login?state=" + state +
            "&response_type=token&client_id=gh-token&redirect_uri=" +
            encodeURIComponent(self)
        window.location.href = login;
        return Promise.delay(1000);
    }

    getUserInfoAsync(): Promise<pxt.editor.UserInfo> {
        if (!this.token())
            return Promise.resolve(undefined);
        return pxt.github.authenticatedUserAsync()
            .then(ghuser => {
                return {
                    id: ghuser.login,
                    userName: ghuser.login,
                    name: ghuser.name,
                    photo: ghuser.avatar_url,
                    profile: `https://github.com/${ghuser.login}`
                }
            }).catch(e => {
                // the token expired or got deleted by the user
                if (e.statusCode == 401) {
                    this.setNewToken(undefined);
                }
                throw e;
            })
    }

    setNewToken(token: string) {
        super.setNewToken(token);
        pxt.github.token = token;
    }

    private showGithubLoginAsync() {
        pxt.tickEvent("github.token.dialog");
        let input: HTMLInputElement;
        return core.confirmAsync({
            header: lf("Sign in to GitHub"),
            hideCancel: true,
            hasCloseIcon: true,
            helpUrl: "/github/token",
            onLoaded: (el) => {
                input = el.querySelectorAll('input')[0] as HTMLInputElement;
            },
            jsx: <div className="ui form">
                <p>{lf("Host your code on GitHub and work together with friends on projects.")}
                    {sui.helpIconLink("/github", lf("Learn more about GitHub"))}</p>
                <p>{lf("You will need a GitHub token:")}</p>
                <ol>
                    <li>
                        {lf("Navigate to: ")}
                        <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer">
                            {lf("GitHub token generation page")}
                        </a>
                    </li>
                    <li>
                        {lf("Put something like 'MakeCode {0}' in description", pxt.appTarget.name)}
                    </li>
                    <li>
                        {lf("Select either '{0}' or '{1}' scope, depending which repos you want to edit from here", "repo", "public_repo")}
                    </li>
                    <li>
                        {lf("Click generate token, copy it, and paste it below.")}
                    </li>
                </ol>
                <div className="ui field">
                    <label id="selectUrlToOpenLabel">{lf("Paste GitHub token here:")}</label>
                    <input type="url" tabIndex={0} autoFocus aria-labelledby="selectUrlToOpenLabel" placeholder="0123abcd..." className="ui blue fluid"></input>
                </div>
            </div>,
        }).then(res => {
            if (!res) {
                pxt.tickEvent("github.token.cancel");
                return Promise.resolve()
            } else {
                const hextoken = input.value.trim();
                return this.saveAndValidateTokenAsync(hextoken);
            }
        })
    }

    private saveAndValidateTokenAsync(hextoken: string): Promise<void> {
        const LOAD_ID = "githubtokensave";
        core.showLoading(LOAD_ID, lf("validating GitHub token..."));
        return Promise.resolve()
            .then(() => {
                if (hextoken.length != 40 || !/^[a-f0-9]+$/.test(hextoken)) {
                    pxt.tickEvent("github.token.invalid");
                    core.errorNotification(lf("Invalid token format"))
                    return Promise.resolve();
                } else {
                    pxt.github.token = hextoken
                    // try to create a bogus repo - it will fail with
                    // 401 - invalid token, 404 - when token doesn't have repo permission,
                    // 422 - because the request is bogus, but token OK
                    // Don't put any string in repo name - github seems to normalize these
                    return pxt.github.createRepoAsync(undefined, "")
                        .then(r => {
                            // what?!
                            pxt.reportError("github", "Succeeded creating undefined repo!")
                            core.infoNotification(lf("Something went wrong with validation; token stored"))
                            this.setNewToken(hextoken);
                            pxt.tickEvent("github.token.wrong");
                        }, err => {
                            pxt.github.token = ""
                            if (!dialogs.showGithubTokenError(err)) {
                                if (err.statusCode == 422)
                                    core.infoNotification(lf("Token validated and stored"))
                                else
                                    core.infoNotification(lf("Token stored but not validated"))
                                this.setNewToken(hextoken);
                                pxt.tickEvent("github.token.ok");
                            }
                        })
                        .then(() => cloudsync.syncAsync())
                }
            }).finally(() => core.hideLoading(LOAD_ID))
    }

    async createRepositoryAsync(projectName: string, header: pxt.workspace.Header): Promise<boolean> {
        pxt.tickEvent("github.filelist.create.start");
        await this.loginAsync();
        if (!this.token()) {
            pxt.tickEvent("github.filelist.create.notoken");
            return false;
        }

        const repoid = await dialogs.showCreateGithubRepoDialogAsync(projectName);
        if (!repoid)
            return false;

        pxt.tickEvent("github.filelist.create.export");
        core.showLoading("creategithub", lf("creating {0} repository...", pxt.github.parseRepoId(repoid).fullName))
        try {
            await workspace.exportToGithubAsync(header, repoid);
            return true;
        } finally {
            core.hideLoading("creategithub");
        }
    }
}
