// ==UserScript==
// @name         3gokushi-simplebuild
// @namespace    http://kite03.x10.bz/mw/
// @version      0.1
// @description  ブラ三 機能を絞った自動施設建設 Tampermonkey用 v3.9
// @author       kitemw
// @match        http://*.3gokushi.jp/village.php
// @match        http://*.3gokushi.jp/user/
// @match        http://*.3gokushi.jp/user/index.php
// @require      http://ajax.googleapis.com/ajax/libs/jquery/1.2.6/jquery.min.js
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// @grant GM_listValues
// @grant GM_xmlhttpRequest
// ==/UserScript==

/* [[変更履歴]]
 * 2014.10.22 v0.1.3  プロフィール画面にて一括初期化ボタンを追加。
 * 2014.10.21 v0.1.2  城・村・砦でレベルアップしなかったバグを修正。
 * 2014.10.21 v0.1.1  すべての施設で自動建設可能なようにする。
 * 2014.10.20 v0.1    木・石・鉄・糧・倉庫・宿舎のみで自動建設スクリプト作成。
 */

"use strict";

// ここにある施設を自動建設する。BUILDKEYSを変更したら、canBuildAnyFacilityのcostsも変える必要あり。
var BUILDKEYS = [
    ["wood", "伐採所"], ["stone", "石切り場"],
    ["iron", "製鉄所"], ["rice", "畑"],
    ["souko", "倉庫"], ["shukusha", "宿舎"]
     , ["kyoten", "拠点"]  // 城はMaxLevel20、村と砦はMaxLevel15。注意。
     , ["ichiba", "市場"]
     , ["renpei", "練兵所"]
     , ["kajiba", "鍛冶場"]
     , ["bougu", "防具工場"]
     , ["kenkyu", "研究所"]
     , ["doujaku", "銅雀台"]
     , ["heiki", "兵器工房"]
     , ["heisha", "兵舎"]
     , ["yumi", "弓兵舎"]
     , ["uma", "厩舎"]
     , ["miharidai", "見張り台"]
     , ["daishukusha", "大宿舎"]
     , ["kunren", "訓練所"]
     , ["enseikunren", "遠征訓練所"]
     , ["suisha", "水車"]
     , ["kojo", "工場"]
];
var GMKEY = location.hostname + "-villages"; // GM_{get|set}valueに使うキー

// *** プログラムの起動はここから。 ***

main();

/**
 * メインルーチン。素で書くとreturnでプログラム終了できないためmainを作った。
 * @returns {undefined} 返す値はない。
 */
function main() {
    // *** プロフィール画面に来たときの処理 ***
    if (location.pathname === '/user/' || location.pathname === '/user/index.php') {
        getUserProf(document);
        appendOptionSettingWindow();
        return;
    }
    if (location.pathname !== 'village.php') {
        return;
    }

    // *** 「都市」タブvillage.phpでの処理 ***
    // GM_関数を使って村・砦の基本情報paramsをロードする。
    // paramsの内容はgetUserProf関数を参照のこと。
    var params = loadParams();

    // 自動巡回の処理
    setRedirect(params);

    // 何も保存されていないときにはプロフィール画面を直接読み込んで村情報を取得する
    if (params === null) {
        getUserProfFromSite();
        return; // 上の関数を読んだ1秒後にvillage.phpがリロードされる
    }

    // 右のサイドバーに入力設定画面を追加する
    appendLevelForm(params);

    // 拠点の数が変わっていないかチェックする。変わっていればデータを更新する
    updateParamsIfChanged(params);

    // 画面中央のマップを基に施設データを取得する
    var facilities = getMapData(); // facilitiesは配列。facilities[.]はオブジェクト。

    // 現在処理中の作業を取得する。但し施設建設に関するデータのみ。
    // 研究や武器強化等はactionsには含まない。
    var actions = getActions();

    // 建設中の施設があるときには何もせずリターンする。
    // 削除中の施設があるときも同様（何もしない）。
    if (actions.length > 0) {
        return;
    }

    var thefac = canBuildAnyFacility(params, facilities);
    if (thefac === -1) {
        return;
    }
    var vi = getCurrentVillageInfo(params);
    var currentIndex = getVillageIndex(params, vi.village_id);
    if (params[currentIndex].forms.validity !== "checked") {
        return;
    }
    var fa = facilities[thefac];
    var c = {};
    c['x'] = fa.dx;
    c['y'] = fa.dy;
    c['village_id'] = vi.village_id;
    c['ssid'] = vi.ssid;
    jQuery.post("http://" + location.hostname + "/facility/build.php",
            c, function () {
            });
    var tid = setTimeout(function () {
        location.reload();
    }, 1000);
}

// *** この行以降、サブルーチン。 ***

/**
 * 村の内部の地図から得られる各施設の情報
 * @constructor
 */
function MapData() {
    /** 村の地図内でのx座標 (0<=dx<=6) */
    this.dx = 0;
    /** 村の地図内でのy座標 (0<=dy<=6) */
    this.dy = 0;
    /** 施設の名前。日本語。例: "石切り場" */
    this.name = "";
    /** 施設のレベル。(1<=level<=最大) */
    this.level = 0;
}

/**
 * 現在表示中の村にどんな施設があるのか調べる。
 * @returns {MapData[]} MapDataオブジェクトを要素とする配列。
 * 施設のレベルが低い順にソートされる。
 */
function getMapData() {
    var ars = jQuery("#mapOverlayMap area");
    var i;
    var n = ars.length;
    var ar;
    var s;
    var result;
    var ss;
    var f;
    var facs = [];
    for (i = 0; i < n; i++) {
        ar = ars[i];
        if (ar.hasAttribute("href") === false || ar.hasAttribute("title") === false) {
            continue;
        }
        s = ar.href;
        result = s.match(/x=(\d+)&y=(\d+)/);
        f = new MapData();  // {};
        f.dx = parseInt(result[1], 10);
        f.dy = parseInt(result[2], 10);
        s = ar.title;
        ss = s.split(" ");
        if (ss.length === 1) {  // 平地の場合はカウントしない
            continue;
        }
        f.name = ss[0];
        result = ss[1].match(/^LV\.(\d+)/);
        f.level = parseInt(result[1], 10);
        facs.push(f);
    }
    facs.sort(function (a, b) { // レベルが低い順に並べる
        return a.level - b.level;
    });
    return facs;
}

/**
 * 村で実施中の作業情報
 * @constructor
 */
function ActionLog() {
    /** 村の地図内でのx座標 (0<=dx<=6) */
    this.dx = 0;
    /** 村の地図内でのy座標 (0<=dy<=6) */
    this.dy = 0;
    /** 作業内容。"constructing"または"deleting"またはnull。 */
    this.status = null;
}

/**
 * 現在表示中の村での、いわゆる「実行中の作業」の内容を調べる。
 * @returns {ActionLog[]} オブジェクトを要素とする配列。
 * 必要な情報は建設中か削除中だけなので、強化とか研究に関する情報は無視する。
 */
function getActions() {
    var lis = jQuery("#actionLog li");
    var als = [];
    var i;
    var n = lis.length;
    var res;
    var spans;
    var span;
    var s;
    var ahrefs;
    var ahref;
    var result;
    for (i = 0; i < n; i++) {
        res = new ActionLog();
        s = lis[i].innerHTML;
        if (s.match(/(建設中|建設準備中)/)) {
            res.status = "constructing";
        } else if (s.match(/削除/)) {
            res.status = "deleting";
        } else {
            continue;
        }
        result = s.match(/x=(\d+)&amp;y=(\d+)/);
        res.dx = parseInt(result[1], 10);
        res.dy = parseInt(result[2], 10);
        als.push(res);
    }
    return als;
}

/**
 * すべての村における自動建設の対象となる施設のレベル設定をロードする。
 * 具体的なデータ内容はgetUserProf関数を参照のこと。
 * @returns {Array|Object}
 */
function loadParams() {
    var json_text = mygetValue(GMKEY, null);
    mydebug("loadParams: json_text=" + json_text);
    if (json_text === null) {
        mydebug("プロファイル画面に行ってください。");
        return null;
    }
    var res = JSON.parse(json_text);
    return res;
}

/**
 * すべての村における自動建設の対象となる施設のレベル設定を保存する。
 * 具体的なデータ内容はgetUserProf関数を参照のこと。
 * @param {Array} params - loadParamsでロードした形式と同じ
 * @returns {undefined} なし。
 */
function saveParams(params) {
    // prototype 1.6.0.2の下ではJSON.stringify(配列)がバグるためtoJSONを使う
    var json_text = params.toJSON();
    mydebug("saveParams: json_text=" + json_text);
    mysetValue(GMKEY, json_text);
}

/**
 * GM_関数とのインターフェース(get)
 * @param {string} key - キー値。
 * @param {string} defValue - 保存されている値がないとき、この値が返ってくる。
 * @returns {string} GM_関数で保存されていた値、またはdefValueの値。
 */
function mygetValue(key, defValue) {
    var value = GM_getValue(key, defValue);
    return value;
}

/**
 * GM_関数とのインターフェース(set)
 * @param {string} key - キー値。
 * @param {string} value - 保存する値。
 * @returns {string} なし
 */
function mysetValue(key, value) {
    GM_setValue(key, value);
}

/**
 * 村・砦画面の下側に、レベル設定用フォームを追加する
 * @param {Array} params - loadParamsでロードした情報
 * @returns {undefined} なし
 */
function appendLevelForm(params) {
    var results = getCurrentVillageInfo(params);
    var village_id = results.village_id;
    var currentIndex = getVillageIndex(params, village_id);
    var forms = params[currentIndex].forms;

    var elemDiv = document.createElement('div');
    elemDiv.setAttribute('class', 'sideBox');
    elemDiv.setAttribute('style', "color: #fff; background: #333; font-size: 10px; padding: 5px 10px;");

    var elemDiv2 = document.createElement('div');
    elemDiv2.setAttribute('class', 'sideBoxHead');
    var elemH3 = document.createElement('h3');
    var elemStrong = document.createElement('strong');
    elemStrong.innerHTML = "village " + village_id;
    elemH3.appendChild(elemStrong);
    elemDiv2.appendChild(elemH3);
    elemDiv.appendChild(elemDiv2);

    var elemDiv3 = document.createElement('div');
    elemDiv3.setAttribute('class', 'sideBoxInner');
    var elemForm = document.createElement('form');
    elemForm.setAttribute('name', 'simplebuild');
    var elemTable = document.createElement('table');
    var s1 = sformat('\
                <tbody>\
                    <tr>\
                        <td>有効</td>\
                        <td><input type="checkbox" name="validity" {checked}></td>\
                        <td colspan="9">&nbsp;</td>\
                    </tr>', {"checked": ((forms.validity === "checked") ?  'checked="checked"' : '')});
    var s2 = sformat('\
                    <tr>\
                        <td>伐採所</td>\
                        <td><input name="wood" type="number" min="0" max="15" value="{wood}"></td>\
                        <td>&nbsp;</td>\
                        <td>拠点</td>\
                        <td><input name="kyoten" type="number" min="0" max="15" value="{kyoten}"></td>\
                        <td>&nbsp;</td>\
                        <td>練兵所</td>\
                        <td><input name="renpei" type="number" min="0" max="10" value="{renpei}"></td>\
                        <td>&nbsp;</td>\
                        <td>銅雀台</td>\
                        <td><input name="doujaku" type="number" min="0" max="10" value="{doujaku}"></td>\
                    </tr>\
                    <tr>\
                        <td>石切り場</td>\
                        <td><input name="stone" type="number" min="0" max="15" value="{stone}"></td>\
                        <td>&nbsp;</td>\
                        <td>倉庫</td>\
                        <td><input name="souko" type="number" min="0" max="20" value="{souko}"></td>\
                        <td>&nbsp;</td>\
                        <td>鍛冶場</td>\
                        <td><input name="kajiba" type="number" min="0" max="10" value="{kajiba}"></td>\
                        <td>&nbsp;</td>\
                        <td>兵器工房</td>\
                        <td><input name="heiki" type="number" min="0" max="15" value="{heiki}"></td>\
                    </tr>\
                    <tr>\
                        <td>製鉄所</td>\
                        <td><input name="iron" type="number" min="0" max="15" value="{iron}"></td>\
                        <td>&nbsp;</td>\
                        <td>市場</td>\
                        <td><input name="ichiba" type="number" min="0" max="10" value="{ichiba}"></td>\
                        <td>&nbsp;</td>\
                        <td>防具工場</td>\
                        <td><input name="bougu" type="number" min="0" max="10" value="{bougu}"></td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                    </tr>\
                    <tr>\
                        <td>畑</td>\
                        <td><input name="rice" type="number" min="0" max="15" value="{rice}"></td>\
                        <td>&nbsp;</td>\
                        <td>宿舎</td>\
                        <td><input name="shukusha" type="number" min="0" max="15" value="{shukusha}"></td>\
                        <td>&nbsp;</td>\
                        <td>研究所</td>\
                        <td><input name="kenkyu" type="number" min="0" max="10" value="{kenkyu}"></td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                    </tr>\
                    <tr>\
                        <td colspan="8">&nbsp;</td>\
                    </tr>\
                    <tr>\
                        <td>兵舎</td>\
                        <td><input name="heisha" type="number" min="0" max="15" value="{heisha}"></td>\
                        <td>&nbsp;</td>\
                        <td>見張り台</td>\
                        <td><input name="miharidai" type="number" min="0" max="16" value="{miharidai}"></td>\
                        <td>&nbsp;</td>\
                        <td>訓練所</td>\
                        <td><input name="kunren" type="number" min="0" max="10" value="{kunren}"></td>\
                        <td>&nbsp;</td>\
                        <td>水車</td>\
                        <td><input name="suisha" type="number" min="0" max="10" value="{suisha}"></td>\
                    </tr>\
                    <tr>\
                        <td>弓兵舎</td>\
                        <td><input name="yumi" type="number" min="0" max="15" value="{yumi}"></td>\
                        <td>&nbsp;</td>\
                        <td>大宿舎</td>\
                        <td><input name="daishukusha" type="number" min="0" max="20" value="{daishukusha}"></td>\
                        <td>&nbsp;</td>\
                        <td>遠征訓練所</td>\
                        <td><input name="enseikunren" type="number" min="0" max="13" value="{enseikunren}"></td>\
                        <td>&nbsp;</td>\
                        <td>工場</td>\
                        <td><input name="kojo" type="number" min="0" max="10" value="{kojo}"></td>\
                    </tr>\
                    <tr>\
                        <td>厩舎</td>\
                        <td><input name="uma" type="number" min="0" max="15" value="{uma}"></td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                        <td>&nbsp;</td>\
                    </tr>\
                </tbody>\
    ', forms);
    elemTable.innerHTML = s1 + s2;
    elemForm.appendChild(elemTable);

    var elemSubmit = document.createElement('input');
    elemSubmit.setAttribute('type', 'button');
    elemSubmit.setAttribute('value', '保存');
    elemSubmit.addEventListener('click', saveFormData, false);
    elemForm.appendChild(elemSubmit);
    elemSubmit = null; // null代入でメモリリークを防止できるらしい。念のため。

    elemDiv3.appendChild(elemForm);
    elemDiv.appendChild(elemDiv3);

    var ww = document.getElementById('whiteWrapper');
    var w1 = ww.children[0];
    ww.insertBefore(elemDiv, w1.nextSibling);
}

/**
 * 村・砦のsidebarに追加したフォームで保存ボタンを押したときの処理
 * @returns {undefined} なし
 */
function saveFormData() {
    var oldparams = loadParams();
    var results = getCurrentVillageInfo(oldparams);
    var village_id = results.village_id;

    var newForms = {};
    if (document.simplebuild.elements.validity.checked) {
        newForms.validity = "checked";
    } else {
        newForms.validity = "false";
    }

    var key;
    var v;
    var i;
    var n = BUILDKEYS.length;
    for (i = 0; i < n; i++) {
        key = BUILDKEYS[i][0];
        v = parseInt(document.simplebuild.elements[key].value, 10);
        newForms[key] = v;
    }
    var currentIndex = getVillageIndex(oldparams, village_id);
    oldparams[currentIndex].forms = newForms;
    saveParams(oldparams);
    newForms = oldparams = null;
    alert('保存しました');
    var tid = setTimeout(function () {
        location.reload();
    }, 1000);
}

/**
 * 今開いているページの本拠地・村・砦のvillage_idとssidを得る。
 * 探し方はxy座標を使う。村の名前等で探す方法は、あとでその名前が変更されることがあるので探し方としては不向き。
 * @param {Array} params - loadParamsでロードした情報
 * @returns {{"village_id": "string", "ssid": "string"}} 村idとssid。
 * ssidは施設をレベルアップするときに使われる。
 */
function getCurrentVillageInfo(params) {
    var xy = jQuery('#basepoint .xy').eq(0).text();
    var village_id = null;
    var i;
    var n = params.length;
    var vobj;
    for (i = 0; i < n; i++) {
        vobj = params[i];
        if (vobj.xy === xy) {
            village_id = vobj.village_id;
            break;
        }
    }
    if (village_id === null) {
        mydebug("getCurrentVillageInfo: this village " + xy
                + " does not exist in params");
        return null;
    }
    var cookiestr = document.cookie;
    var ssid = cookiestr.match(/SSID=([a-z0-9]+)/)[1];
    mydebug("village_id=" + village_id + " ssid=" + ssid);
    return {
        "village_id": village_id,
        "ssid": ssid
    };
}

/**
 * ユーザープロフィール画面のurlまで読みに行って拠点情報を取得する
 * @returns {undefined} なし。実際はgetUserProf関数で様々な情報を得ている。
 */
function getUserProfFromSite() {
    setTimeout(function () {
        GM_xmlhttpRequest({
            method: "GET",
            url: "http://" + location.hostname + "/user/",
            headers: {
                "Content-type": "text/html"
            },
            overrideMimeType: 'text/html; charset=utf-8',
            onload: function (x) {
                var htmldoc = document.createElement("html");
                htmldoc.innerHTML = x.responseText;
                getUserProf(htmldoc);
                var tid = setTimeout(function () {
                    location.reload();
                }, 1000); // msec
            }
        });
    }, 1000); // msec
}

/**
 * 村の各種情報。ユーザープロフィール画面から得る。
 * @constructor
 */
function VillageData() {
    /** 村ID */
    this.village_id = "";
    /** 村の名前 */
    this.name = "";
    /** 全体地図における村の座標。"(xxx,yy)"の形 */
    this.xy = "";
    /** 別の村に移動するときのurl。 児童巡回に使う */
    this.url = "";
    /** レベル設定に使うデータ */
    this.forms = {};
}

/**
 * ユーザプロフィール画面の拠点情報を取得する。
 * @param {type} htmldoc
 * @returns {undefined} なし
 */
function getUserProf(htmldoc) {
    var oldparams = loadParams(); // oldparamsはnullであることがあるが、よくあることなので問題なし。
    var landElems = document.evaluate(
            '//*[@id="gray02Wrapper"]//table/tbody/tr', htmldoc, null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    var newparams = [];
    var isLandList = false;
    for (var i = 0; i < landElems.snapshotLength; i++) {
        var item = landElems.snapshotItem(i);

        if (!isLandList) {
            // 「国情報」の行まで読み込みをスキップする
            var childElement = getChildElem(item, 0);
            if (childElement && trim(childElement.innerHTML) === "名前") {
                // if (trim(getChildElem(item, 0).innerHTML) == "名前") {
                isLandList = true;
            }
            continue;
        }

        // 名前項目を取得
        var nameElem = getChildElem(getChildElem(item, 0), 0);
        var name = trim(nameElem.innerHTML);
        var url = nameElem.href;

        // urlからvillage_idを読む
        var village_id = url.match(/village_id=([0-9]+)/)[1];

        // 座標項目を取得
        var xy = "("
                + getChildElem(item, 1).innerHTML.match(/-?[0-9]+\,-?[0-9]+/i)
                + ")";

        // 人口項目を取得
        var popul = getChildElem(item, 2).innerHTML;

        // 拠点じゃなければ終了
        if (!isNumeric(popul))
            break;

        var newVil = new VillageData();
        newVil.village_id = village_id;
        newVil.name = name;
        newVil.xy = xy;
        newVil.url = url;
        var currentIndex = getVillageIndex(oldparams, village_id);
        if (currentIndex === -1) {
            var newForm = {};
            var nn = BUILDKEYS.length;
            for (var j = 0; j < nn; j++) {
                var key = BUILDKEYS[j][0];
                newForm[key] = 0;
            }
            newVil.forms = newForm;
        } else {
            newVil.forms = oldparams[currentIndex].forms;
        }
        newparams.push(newVil);
    }

    // 保存
    saveParams(newparams);
    oldparams = null;
}

/**
 * village_idで指定した村がparamsの何番目の配列にあるかを返す。
 * @param {Array} params - loadParamsでロードした情報
 * @param {string} village_id - 村ID
 * @returns {number} params[i]のi。見つからなければ-1を返す。
 */
function getVillageIndex(params, village_id) {
    if (params === null) {
        return -1;
    }
    var i;
    var n = params.length;
    var obj;
    for (i = 0; i < n; i++) {
        obj = params[i];
        if (obj.village_id === village_id) {
            return i;
        }
    }
    return -1;
}

/**
 * 子Element取得
 * @param {type} parentNode
 * @param {type} position
 * @returns {getChildElem.childNode}
 */
function getChildElem(parentNode, position) {
    var current = 0;
    for (var i = 0; i < parentNode.childNodes.length; i++) {
        var childNode = parentNode.childNodes[i];
        if (childNode.nodeType === Node.ELEMENT_NODE) {
            if (current === position) {
                return childNode;
            }
            current++;
        }
    }
    return undefined;
}

/**
 * 空白除去
 * @param {string} str
 * @returns {string}
 */
function trim(str) {
    if (str === undefined) {
        return "";
    }
    return str.replace(/^[ 　\t\r\n]+|[ 　\t\r\n]+$/g, "");
}

/**
 * 数値チェック
 * @param {*} num
 * @returns {boolean}
 */
function isNumeric(num) {
    if (num.match(/^-?[0-9]+$/)) {
        return true;
    }
    return false;
}

/**
 * 拠点データが変わったかどうか調べて、変わっていたらユーザープロフィール画面から情報を読み直す
 * @param {Array} params - loadParamsで得られた情報
 * @returns {undefined} なし
 */
function updateParamsIfChanged(params) {
    var xys = getKyotenData();
    mydebug("xys=" + xys);
    if (isKyotenXYSame(params, xys) === false) {
        getUserProfFromSite();
    }
}

/**
 * サイドバーの拠点情報を読み、xy座標の配列を選んで返す。paramsのxyと比較する情報として使う
 * @returns {Array.<string>}
 */
function getKyotenData() {
    var lis = jQuery('.sideBoxInner.basename').eq(0).find('li');
    var n = lis.length;
    var i;
    var li;
    var s;
    var xys = [];
    for (i = 0; i < n; i++) {
        li = lis[i];
        s = "(" + li.innerHTML.match(/-?[0-9]+\,-?[0-9]+/i) + ")";
        xys.push(s);
    }
    return xys;
}

/**
 * params中のxyとxyarrayが一致していればtrue, 違っていればfalseを返す
 * @param {Array} params - loadParamsで得られた情報
 * @param {Array.<string>} xyarray - getKyotenDataで得られた情報
 * @returns {Boolean}
 */
function isKyotenXYSame(params, xyarray) {
    var pn = params.length;
    var xyn = xyarray.length;
    if (pn !== xyn) { // 要素数が違うときは問答無用でfalse
        return false;
    }
    var i;
    var p;
    for (i = 0; i < pn; i++) {
        p = params[i].xy;
        if (xyarray.indexOf(p) === -1) { // 見たことがないxy座標を発見した
            return false;
        }
    }
    return true;
}

/**
 * レベルアップ可能な施設があるか調べる。
 * @param {type} params - loadParamsで得られた情報
 * @param {type} facilities - getMapDataで得られた情報
 * @returns {Number} レベルアップ可能な施設のindex。facilities[index]が対象施設。
 */
function canBuildAnyFacility(params, facilities) {
    var cost_wood = [[10, 35, 40, 15], [25, 88, 100, 38],
        [58, 202, 230, 86], [173, 604, 690, 259],
        [431, 1510, 1725, 647], [1466, 2847, 3019, 1294],
        [2493, 4839, 5132, 2200], [3490, 6775, 7186, 3080],
        [4537, 8807, 9341, 4003], [5898, 11450, 12144, 5204],
        [8119, 14434, 15787, 6766], [11366, 20207, 22101, 9472],
        [17050, 30311, 33152, 14208], [25575, 45467, 49729, 21312],
        [38362, 68199, 74593, 31698]];
    var cost_stone = [[40, 10, 35, 15], [100, 25, 88, 38],
        [230, 58, 202, 86], [690, 173, 604, 259],
        [1725, 431, 1510, 647], [3019, 1466, 2847, 1294],
        [5132, 2493, 4839, 2200], [7186, 3490, 6775, 3080],
        [9341, 4537, 8807, 4003], [12144, 5898, 11450, 5204],
        [15787, 8119, 14434, 6766], [22101, 11366, 20207, 9472],
        [33152, 17050, 30311, 14208], [49729, 25575, 45467, 21312],
        [74593, 38362, 68199, 31968]];
    var cost_iron = [[35, 40, 10, 15], [88, 100, 25, 38],
        [202, 230, 58, 86], [604, 690, 173, 259],
        [1510, 1725, 431, 647], [2847, 3019, 1466, 1294],
        [4839, 5132, 2493, 2200], [6775, 7186, 3490, 3080],
        [8807, 9341, 4537, 4003], [11450, 12144, 5898, 5204],
        [14434, 15787, 8119, 6766], [20207, 22101, 11366, 9472],
        [30311, 33152, 17050, 14208], [45467, 49729, 25575, 21312],
        [68199, 74593, 38362, 31968]];
    var cost_rice = [[35, 35, 30, 0], [88, 88, 75, 0],
        [202, 202, 173, 0], [604, 604, 518, 0],
        [1510, 1510, 1294, 0], [3019, 3019, 2588, 0],
        [5132, 5132, 4399, 0], [7186, 7186, 6159, 0],
        [9341, 9341, 8007, 0], [12144, 12144, 10409, 0],
        [15787, 15787, 13532, 0], [22101, 22101, 18944, 0],
        [33152, 33152, 28416, 0], [49729, 49729, 42625, 0],
        [74593, 74593, 63937, 0]];
    var cost_souko = [
        [83, 141, 83, 63],
        [167, 281, 167, 126],
        [300, 506, 300, 226],
        [479, 810, 479, 362],
        [671, 1134, 671, 507],
        [1044, 1253, 1044, 835],
        [1462, 1754, 1462, 1169],
        [1973, 2368, 1973, 1578],
        [2664, 3196, 2664, 2131],
        [3596, 4315, 3596, 2877],
        [4854, 5825, 4854, 3883],
        [6311, 7573, 6311, 5048],
        [8204, 9845, 8204, 6563],
        [10255, 12306, 10255, 8204],
        [12819, 15382, 12819, 10255],
        [15382, 18459, 15382, 12306],
        [18459, 22151, 18459, 14767],
        [21228, 21228, 25473, 16982],
        [24412, 29294, 24412, 19529],
        [28074, 33688, 28074, 22459]
    ];
    var cost_shukusha = [
        [35, 20, 35, 80],
        [53, 30, 53, 120],
        [89, 51, 89, 204],
        [147, 84, 147, 337],
        [228, 130, 228, 522],
        [336, 192, 336, 767],
        [476, 272, 476, 1089],
        [653, 373, 653, 1492],
        [868, 496, 868, 1984],
        [1129, 645, 1129, 2580],
        [2032, 1161, 2032, 4644],
        [3658, 2090, 3658, 4644],
        [6951, 3971, 6950, 15882],
        [13205, 7544, 13205, 30177],
        [25090, 14334, 25090, 57336]
    ];
    var cost_kojo = [
        [780, 1560, 1560, 3900],
        [1248, 2496, 2496, 6240],
        [1997, 3994, 3994, 9984],
        [4193, 6290, 6290, 11182],
        [5871, 8806, 8806, 15655],
        [10958, 13698, 13698, 16437],
        [15342, 19177, 19177, 23013],
        [19944, 24930, 24930, 29916],
        [25928, 32410, 32410, 38891],
        [33706, 42132, 42132, 50559]
    ];
    var cost_suisha = [
        [2940, 980, 980, 4900],
        [4704, 1568, 1568, 7840],
        [7526, 2509, 2509, 12544],
        [10537, 5268, 5268, 14049],
        [14751, 7376, 7376, 19668],
        [20652, 13768, 13768, 20652],
        [28913, 19275, 19275, 28913],
        [37587, 25058, 25058, 37587],
        [48863, 32576, 32576, 48863],
        [63523, 42348, 42348, 63523]
    ];
    var cost_ichiba = [
        [100, 100, 50, 50],
        [334, 334, 191, 191],
        [1035, 1035, 592, 592],
        [2795, 2795, 1600, 1600],
        [6328, 6328, 4218, 4218],
        [13288, 13288, 8859, 8859],
        [25248, 25248, 16832, 16832],
        [42921, 42921, 28614, 28614],
        [64381, 64381, 42921, 42921],
        [90134, 90134, 60089, 60089]
    ];
    var cost_kenkyu = [
        [275, 110, 110, 55],
        [413, 165, 165, 83],
        [619, 248, 248, 124],
        [1486, 836, 836, 557],
        [2228, 1253, 1253, 836],
        [7521, 6267, 6267, 5015],
        [13538, 11282, 11282, 9025],
        [21436, 17862, 17862, 14290],
        [44675, 37228, 37228, 29784],
        [87725, 73104, 73104, 58483]
    ];
    var cost_kunren = [
        [1500, 1600, 2500, 3300],
        [2100, 2240, 3500, 3300],
        [2940, 3136, 4900, 6468],
        [6629, 7326, 13955, 6978],
        [13257, 14653, 27910, 13955],
        [32097, 37679, 55821, 13955],
        [64194, 75358, 111642, 27910],
        [128388, 150716, 223283, 55821],
        [256776, 301432, 446566, 111642],
        [513551, 602865, 893133, 223283]
    ];
    var cost_kajiba = [
        [150, 200, 340, 170],
        [400, 300, 680, 340],
        [780, 585, 1326, 663],
        [1482, 1112, 2519, 1260],
        [2742, 2056, 4661, 2330],
        [4935, 3701, 8390, 4195],
        [8636, 6477, 14682, 7341],
        [17640, 14112, 28223, 10584],
        [31566, 25253, 50506, 18940],
        [50506, 40404, 80809, 30303]
    ];
    var cost_bougu = [
        [150, 200, 340, 170],
        [300, 400, 680, 340],
        [585, 780, 1326, 663],
        [1112, 1482, 2519, 1260],
        [2056, 2742, 4661, 2330],
        [3701, 4935, 8390, 4195],
        [6477, 8636, 14682, 7341],
        [14112, 17640, 28223, 10584],
        [25253, 31566, 50506, 18940],
        [40404, 50506, 80809, 30303]
    ];
    var cost_heiki = [
        [216, 216, 216, 72],
        [432, 432, 432, 144],
        [864, 864, 864, 288],
        [1224, 1224, 1224, 648],
        [1836, 1836, 1836, 972],
        [2662, 2662, 2662, 1409],
        [3860, 3860, 3860, 2044],
        [7357, 7357, 7357, 2452],
        [13242, 13242, 13242, 4414],
        [23836, 23836, 23836, 7945],
        [42905, 42905, 42905, 14302],
        [77229, 77229, 77229, 25743],
        [139013, 139013, 139013, 46338],
        [278026, 278026, 278026, 92675],
        [556051, 556051, 556051, 185350]
    ];
    var cost_doujaku = [
        [700, 3500, 2100, 700],
        [1120, 5600, 3360, 1120],
        [1792, 8960, 5376, 1792],
        [3763, 10035, 7526, 3763],
        [5263, 14049, 10537, 5268],
        [9834, 14752, 14752, 9834],
        [13768, 20652, 20652, 13768],
        [17899, 26848, 26848, 17899],
        [23268, 34902, 34902, 23268],
        [30249, 45373, 45373, 30249]
    ];
    var cost_renpei = [
        [112, 107, 107, 122],
        [224, 214, 214, 244],
        [448, 428, 428, 488],
        [759, 725, 725, 826],
        [1214, 1160, 1160, 1322],
        [2209, 2110, 2110, 2406],
        [3331, 3182, 3182, 3627],
        [4958, 4736, 4736, 5400],
        [8091, 7729, 7729, 8813],
        [11130, 10632, 10632, 12122]
    ];
    var cost_heisha = [
        [72, 360, 72, 216],
        [144, 720, 144, 432],
        [288, 1440, 288, 864],
        [648, 1728, 648, 1296],
        [972, 2592, 972, 1944],
        [1409, 3758, 1409, 2819],
        [2725, 4088, 2725, 4088],
        [6744, 9810, 5518, 2453],
        [12140, 17658, 9933, 4415],
        [21852, 31784, 17879, 7946],
        [39333, 57212, 32182, 14303],
        [70800, 96545, 64364, 25745],
        [127440, 173781, 115854, 46342],
        [254879, 324392, 254879, 92683],
        [509759, 648784, 509759, 185367]
    ];
    var cost_yumi = [
        [360, 72, 72, 216],
        [720, 144, 144, 432],
        [1440, 288, 288, 864],
        [1728, 648, 648, 1296],
        [2592, 972, 972, 1944],
        [3758, 1409, 1409, 2819],
        [5450, 2044, 2044, 4087],
        [9810, 6131, 6131, 2453],
        [17658, 12140, 9933, 4415],
        [31784, 21852, 17879, 7946],
        [57212, 39333, 32182, 14303],
        [96545, 70800, 64364, 25745],
        [173781, 127440, 115854, 46342],
        [324392, 254879, 254879, 92683],
        [648784, 509759, 509759, 185367]
    ];
    var cost_uma = [
        [72, 72, 360, 216],
        [144, 144, 720, 432],
        [288, 288, 1440, 864],
        [648, 648, 1728, 1296],
        [972, 972, 2592, 1944],
        [1409, 1409, 3758, 2891],
        [2044, 2044, 5450, 4087],
        [5518, 6744, 9810, 2453],
        [9933, 12140, 17658, 4415],
        [17879, 21852, 31784, 7946],
        [32182, 39333, 57212, 14303],
        [64364, 70800, 96545, 25745],
        [115854, 127440, 173781, 46342],
        [254879, 254879, 324392, 92683],
        [509759, 509759, 648784, 185367]
    ];
    var cost_shiro = [
        [0, 0, 0, 0],
        [1404, 546, 390, 780],
        [2570, 1000, 714, 1428],
        [4161, 2081, 2081, 2081],
        [7102, 3552, 3552, 3552],
        [9056, 9056, 6037, 6037],
        [14384, 14384, 9589, 9589],
        [22773, 22773, 15183, 15183],
        [33562, 33562, 22374, 22374],
        [44402, 57559, 32890, 29602],
        [65122, 84418, 48239, 43415],
        [95317, 123558, 70605, 63544],
        [113458, 154716, 154716, 92830],
        [150418, 150418, 315878, 135375],
        [219008, 219008, 492770, 164258],
        [294820, 294820, 663345, 221115],
        [488220, 488220, 827854, 318406],
        [839130, 839130, 915414, 457707],
        [1307581, 1307581, 1354280, 700491],
        [1901938, 1901938, 1969864, 1018896]
    ];
    var cost_toride = [
        [104, 400, 136, 160],
        [243, 936, 319, 374],
        [438, 1685, 573, 673],
        [1110, 2467, 1357, 1233],
        [1887, 4194, 2307, 2097],
        [3236, 7191, 3954, 3596],
        [5177, 11505, 6327, 5753],
        [10430, 18776, 13560, 9387],
        [18839, 33912, 24492, 16956],
        [33914, 61043, 44087, 30523],
        [66939, 106495, 85196, 45640],
        [119786, 190570, 152456, 81672],
        [213820, 340166, 272133, 145786],
        [423566, 505021, 456148, 244365],
        [708513, 844765, 763014, 408756]
    ];
    var cost_mura = [
        [400, 136, 104, 160],
        [936, 319, 243, 374],
        [1685, 573, 438, 673],
        [2467, 1357, 1110, 1233],
        [4194, 2307, 1887, 2097],
        [7191, 3954, 3236, 3596],
        [11505, 6327, 5177, 5753],
        [18776, 13560, 10430, 9387],
        [33912, 24492, 18839, 16956],
        [61043, 44087, 33914, 30523],
        [106495, 85196, 66939, 45640],
        [190570, 152456, 119786, 81672],
        [340166, 272133, 213820, 145786],
        [505021, 456148, 423566, 244365],
        [844765, 763014, 708513, 408756]
    ];
    var cost_daishukusha = [
        [200, 114, 200, 438],
        [320, 183, 320, 701],
        [512, 293, 512, 1121],
        [768, 439, 768, 1682],
        [1152, 658, 1152, 2523],
        [1728, 987, 1728, 3784],
        [2419, 1382, 2419, 5298],
        [3387, 1935, 3387, 7418],
        [4741, 2709, 4741, 10385],
        [6637, 3793, 6637, 14538],
        [8628, 4930, 8628, 18900],
        [11217, 6409, 11217, 24570],
        [14582, 8332, 14582, 31941],
        [18956, 11735, 18956, 40620],
        [25817, 16429, 25817, 49286],
        [32271, 22003, 32271, 60141],
        [42172, 29337, 42172, 69675],
        [52715, 38963, 52715, 84803],
        [66009, 49506, 66009, 93512],
        [79211, 62708, 79211, 108914]
    ];
    var cost_enseikunren = [
        [2884, 4486, 5977, 2723],
        [4614, 7177, 9484, 4357],
        [7382, 11483, 15174, 6972],
        [11811, 18373, 24279, 11155],
        [18898, 29397, 38846, 17848],
        [28347, 44096, 58269, 26772],
        [42521, 66143, 87404, 40158],
        [63781, 99215, 131105, 60238],
        [89294, 138901, 183548, 84333],
        [125011, 194461, 256967, 118066],
        [175015, 272246, 359754, 165292],
        [227520, 353920, 467680, 214880],
        [295776, 460096, 607984, 279344]
    ];
    var cost_miharidai = [
        [600, 840, 600, 360],
        [960, 1344, 960, 576],
        [1536, 2150, 1536, 922],
        [2458, 3441, 2458, 1475],
        [3932, 5505, 3932, 2359],
        [6291, 8808, 6291, 3775],
        [9437, 13212, 9437, 5662],
        [14156, 19818, 14156, 8493],
        [21233, 29727, 21233, 12740],
        [31850, 44590, 31850, 19110],
        [44590, 62426, 44590, 26754],
        [62426, 87396, 62426, 37456],
        [87397, 122355, 87397, 52438],
        [122355, 171297, 122355, 73413],
        [159062, 222686, 159062, 95437],
        [206780, 289492, 206780, 124068]
    ];
    /* 修行所は廃止されました
    var cost_shugyoujo = [
        [1600, 1200, 600, 600],
        [2240, 1680, 840, 840],
        [3136, 2352, 1176, 1176],
        [4390, 3293, 1646, 1646],
        [6146, 4610, 2305, 2305],
        [8605, 6454, 3227, 3227],
        [11186, 8390, 4195, 4195],
        [14542, 10907, 5453, 5453],
        [18905, 14179, 7089, 7089],
        [24577, 18433, 9216, 9216],
        [31950, 23963, 11981, 11981],
        [38340, 28755, 14378, 14378],
        [46008, 34506, 17253, 17253],
        [55210, 41407, 20704, 20704],
        [66252, 49689, 24844, 24844],
        [72877, 54658, 27329, 27329],
        [80164, 60123, 30062, 30062],
        [88181, 66136, 33068, 33068],
        [96999, 72749, 36375, 36375],
        [106699, 80024, 40012, 40012]
    ];
    */
    
    var s = "";
    var i;
    var n = BUILDKEYS.length;
    var key;
    var sj;
    for (i = 0; i < n - 1; i++) {
        key = BUILDKEYS[i][0];
        if (key === "kyoten") {
            sj = facilities.toJSON();
            if (sj.match(/城/) !== null) {
                key = "shiro";
            } else if (sj.match(/村/) !== null) {
                key = "mura";
            } else {
                key = "toride";
            }
        }
        s += "cost_" + key;
        if (i !== n - 1) {
            s += ",";
        }
    }
    s = "var costs = [" + s + "];";
    eval(s);  // evalは常に取り扱い注意
    //var costs = [cost_wood, cost_stone, cost_iron, cost_rice,
    //    cost_souko, cost_shukusha];
    var resources = [
        parseInt(jQuery('#wood').text(), 10),
        parseInt(jQuery('#stone').text(), 10),
        parseInt(jQuery('#iron').text(), 10),
        parseInt(jQuery('#rice').text(), 10)
    ];

    var j;
    n = facilities.length;
    var name;
    var lvl, v;
    for (i = 0; i < n; i++) {
        name = facilities[i].name;
        if (name === "城" || name === "村" || name === "砦") {
            name = "拠点";
        }
        j = getBuildIndex(name);
        if (j === -1) {
            continue;
        }
        lvl = facilities[i].level;
        v = parseInt(document.simplebuild.elements[BUILDKEYS[j][0]].value, 10);
        if (lvl >= v) {
            continue;
        }
        if (costs[j][lvl][0] <= resources[0] &&
                costs[j][lvl][1] <= resources[1] &&
                costs[j][lvl][2] <= resources[2] &&
                costs[j][lvl][3] <= resources[3]) {
            mydebug("can build " + name + " level " + lvl);
            return i;
        }
    }
    mydebug("建設可能な施設はありません。");
    return -1;

    function getBuildIndex(name) {
        var j;
        var n = BUILDKEYS.length;
        for (j = 0; j < n; j++) {
            if (BUILDKEYS[j][1] === name) {
                return j;
            }
        }
        return -1;  // BUILDKEY内にnameがないときは-1を返す
    }
}

/**
 * ユーザープロフィール画面にオプション設定画面を追加する
 * @returns {undefined} なし
 */
function appendOptionSettingWindow() {
    var opObj = loadOptionData();
    
    var elemDiv = document.createElement('div');
    elemDiv.setAttribute('class', 'sideBox');

    var elemDiv2 = document.createElement('div');
    elemDiv2.setAttribute('class', 'sideBoxHead');
    var elemH3 = document.createElement('h3');
    var elemStrong = document.createElement('strong');
    elemStrong.innerHTML = "sbオプション設定";
    elemH3.appendChild(elemStrong);
    elemDiv2.appendChild(elemH3);
    elemDiv.appendChild(elemDiv2);

    var elemDiv3 = document.createElement('div');
    elemDiv3.setAttribute('class', 'sideBoxInner');
    var elemForm = document.createElement('form');
    elemForm.setAttribute('name', 'simplebuildoption');
    var elemTable = document.createElement('table');
    elemTable.setAttribute('class', 'situationTable');
    var elemTbody = document.createElement('tbody');
    var elemTr0 = document.createElement('tr');
    var elemTd0 = document.createElement('td');
    elemTd0.innerHTML = '巡回する';
    elemTr0.appendChild(elemTd0);
    var elemTd01 = document.createElement('td');
    var elemCheckbox = document.createElement('input');
    elemCheckbox.setAttribute('type', 'checkbox');
    elemCheckbox.setAttribute('name', 'circ');
    if (opObj.ci === "checked") {
        elemCheckbox.setAttribute('checked', 'checked');
    }
    elemTd01.appendChild(elemCheckbox);
    elemTr0.appendChild(elemTd01);
    elemTbody.appendChild(elemTr0);

    var elemTr = document.createElement('tr');
    var elemTd1 = document.createElement('td');
    elemTd1.innerHTML = '巡回間隔(分)';
    elemTr.appendChild(elemTd1);
    var elemTd2 = document.createElement('td');
    var elemNumber = document.createElement('input');
    elemNumber.setAttribute('type', 'number');
    elemNumber.setAttribute('name', 'intervalMinute');
    elemNumber.setAttribute('min', '3');
    elemNumber.setAttribute('max', '24');
    elemNumber.setAttribute('step', '3');
    elemNumber.setAttribute('value', opObj.im);
    elemNumber.setAttribute('style', 'width:35pm');
    elemTd2.appendChild(elemNumber);
    elemTr.appendChild(elemTd2);
    elemTbody.appendChild(elemTr);

    elemTable.appendChild(elemTbody);
    elemForm.appendChild(elemTable);

    var elemSubmit = document.createElement('input');
    elemSubmit.setAttribute('type', 'button');
    elemSubmit.setAttribute('value', '保存');
    elemSubmit.addEventListener('click', saveOptionData, false);
    elemForm.appendChild(elemSubmit);
    elemSubmit = null;
    
    var elemDivZ = document.createElement('div');
    elemDivZ.innerHTML = '&nbsp;';
    elemForm.appendChild(elemDivZ);
    
    var elemAllClear = document.createElement('input');
    elemAllClear.setAttribute('type', 'button');
    elemAllClear.setAttribute('value', '一括初期化');
    elemAllClear.addEventListener('click', deleteAllSavedData, false);
    elemForm.appendChild(elemAllClear);
    elemAllClear = null;

    elemDiv3.appendChild(elemForm);
    elemDiv.appendChild(elemDiv3);

    var sb = document.getElementById('sidebar');
    sb.appendChild(elemDiv);
}

/**
 * オプション用画面で保存ボタンを押したときの処理
 * @returns {undefined} なし
 */
function saveOptionData() {
    var opObj = {};
    if (document.simplebuildoption.elements.circ.checked === true) {
        opObj.ci = "checked";
    } else {
        opObj.ci = "false";
    }
    opObj.im = document.simplebuildoption.elements.intervalMinute.value;
    var json_text = JSON.stringify(opObj);
    mydebug("saveOptionData: json_text=" + json_text);
    mysetValue(GMKEY + "-Options", json_text);
    alert("保存しました。");
    var tid = setTimeout(function () {
        location.reload();
    }, 1000);
}

/**
 * オプション画面で使うデータをロードする
 * @returns {{"ci": string, "im": string}}
 */
function loadOptionData() {
    var json_text = mygetValue(GMKEY + "-Options", null);
    if (json_text === null) {
        return {"ci": "false", "im": "3"};
    }
    mydebug("loadOptionData: json_text=" + json_text);
    var opObj = JSON.parse(json_text);
    return opObj;
}

/**
 * オプション画面で一括初期化ボタンを押したときの処理。
 * 本当に初期化してよいか確認した後、拠点画面で入力した値をすべて消去する。
 * 「消去」と言っても実際にGM_setValueで保存した値が消えるわけではなく、
 * いわゆる「工場初期化」のようにすべて最初の状態に戻るだけなので、
 * Tampermonkeyのstorageには(初期化されたデータが)残る。
 * @returns {undefined} なし
 */
function deleteAllSavedData() {
    var canDelete = confirm("拠点で設定された数値等を含めて、すべて消去されます。本当によろしいですか？");
    if (canDelete === false) {
        alert('一括初期化を中止しました。');
        return;
    }
    GM_deleteValue(GMKEY);
    GM_deleteValue(GMKEY + '-Options');
    alert('データをすべて消去し、初期化しました。');
    var tid = setTimeout(function () {
        location.reload();
    }, 1000);
}

/**
 * オプション画面で使うデータを保存する
 * @param {{"ci": string, "im": string}} params - 本機能有効フラグ,巡回時間(分)
 * @returns {undefined}
 */
function setRedirect(params) {
    var op = loadOptionData();
    if (op.ci === "false") {
        return;
    }
    var minute = parseInt(op.im, 10) * 60000;
    var resobj = getCurrentVillageInfo(params);
    var currentVillageId = resobj.village_id;
    var nextVillageHref = getNextVillageUrl(params, currentVillageId);
    mydebug("setRedirect: next href=" + nextVillageHref);
    if (nextVillageHref === null) {
        var tid = setTimeout(function () {
            location.reload();
        }, minute);
    } else {
        var tid = setTimeout(function () {
            location.href = nextVillageHref;
        }, minute);
    }
}

/**
 * currentVillageIdで指定した村の「次」の村を探し、次の村のurlを返す
 * @param {Array} params - loadParamsで得られた情報
 * @param {string} currentVillageId - 村ID
 * @returns {string} - VillageData[i].url
 */
function getNextVillageUrl(params, currentVillageId) {
    var i = getVillageIndex(params, currentVillageId);
    var n = params.length;
    var j = i;
    var obj;
    while (true) {
        j = j + 1;
        if (j === n) {
            j = 0;
        }
        if (j === i) {
            return null;
        }
        obj = params[j];
        if (obj.forms.validity === "checked") {
            return obj.url;
        }
    }
}

/**
 * nameで指定した施設の最大レベルを得る。
 * @param {string} name - 施設の名前。日本語。
 * @returns {number} 最大レベルの数字。nameで見つからなかったときは0を返す
 */
function getMaxFacilityLevel(name) {
    var dic = {
        "伐採所": 15, "石切り場": 15, "製鉄所": 15, "畑": 15,
        "城": 15, "砦": 15, "村": 15, "倉庫": 20, "市場": 10,
        "宿舎": 15, "練兵所": 10, "鍛冶場": 10, "防具工場": 10,
        "研究所": 10, "銅雀台": 10, "兵器工房": 15,
        "兵舎": 15, "弓兵舎": 15, "厩舎": 15, "見張り台": 16,
        "大宿舎": 20, "訓練所": 10, "遠征訓練所": 13,
        "水車": 10, "工場": 10
    };
    if (dic.hasOwnProperty(name)) {
        return dic[name];
    }
    return 0;
}

/**
 * template文字列中にある"{ARG1}"をobjオブジェクト内の文字列に置換する
 * @param {string} template - テンプレート
 * @param {object} obj - オブジェクト
 * @returns {string} テンプレート中のすべての{.}が置換された後の文字列。
 * objのキーが存在しなかった場合、"{ARG1}"は0とする。
 */
function sformat(template, obj) {
    return template.replace(/\{(.+?)\}/g, function(org, c) {
        //mydebug("org=" + org + ", c=" + c);
        //mydebug("obj[c]=" + obj[c]);
        return obj.hasOwnProperty(c) ? obj[c] : 0;
    });
}

/**
 * (デバッグ用)
 * @param {string} a - コンソールに出力したい文字列
 * @returns {undefined} - (なし)
 */
function mydebug(a) {
    console.log(a);
}
