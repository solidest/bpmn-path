const binParser = require("../parser/BinParser");
const shortid = require('shortid');

//helper for 处理表达式
function handleExp(str_exp) {
    let ast = binParser.parse(str_exp);
    return ast.value_text("argv");
}

//获取recv原语的脚本
function getRecvScript(prim) {
    let scripts = [];
    let tableName = shortid.generate();
    let proInfo = prim.binding;
    scripts.push(`\t--在${prim.schannel}接口上，按照${prim.protocol}协议来接收数据`);
    scripts.push(`\tlocal ${tableName} = recv(cit.${prim.schannel}, cpt.${prim.protocol}, ${prim.timeout})`);
    for (let seg of proInfo) {
        if (seg.bindtype == "assert.ok") {
            //当bindtype为assert时，转化为assert.ok语句
            let vbind = seg.vbind.replace(/\s*/g, "");
            vbind = vbind.split("==")[1];
            scripts.push(`\tassert.ok(${tableName}.${seg.name} == ${vbind})`);
        } else if (seg.bindtype == "value") {
            //当bindtype为value时，给指定参数赋值
            if (seg.vbind)
                scripts.push(`\targv.${seg.vbind} = ${tableName}.${seg.name}`);
        } else {
            console.log("错误的绑定类型！");
        }
    }
    return scripts;
}

//获取send原语的脚本
function getSendScript(prim) {
    let scripts = [];
    let tableName = shortid.generate();
    let proInfo = prim.binding;
    scripts.push(`\t--按协议字段组成构造出一个table来`);
    scripts.push(`\tlocal ${tableName} = {}`);
    let iniList = [] //初始化的列表
    for (let seg of proInfo) {
        if (seg.vbind) {
            //当vbind绑定的是一个group中的子字段时，检查父字段有没有初始化
            if (/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/.test(seg.name)) {
                let group = seg.name.split(".")[0];
                if (iniList.indexOf(group) == -1) {
                    scripts.push(`\t${tableName}.${seg.name} = {}`);
                    scripts.push(`\t${tableName}.${seg.name} = ${handleExp(seg.vbind)}`);
                    iniList.push(group);
                } else {
                    scripts.push(`\t${tableName}.${seg.name} = ${handleExp(seg.vbind)}`);
                }

            } else {
                //当vbind不是表达式时，handleExp会报错，使用trycatch捕获，例如"vbind": "crc(SUM8, longitude, latitude)"
                try {
                    scripts.push(`\t${tableName}.${seg.name} = ${handleExp(seg.vbind)}`);
                } catch (e) {
                    scripts.push(`\t${tableName}.${seg.name} = ${seg.vbind}`);
                }
            }

            //以下是利用参数列表的方法来判断参数，已经废弃
            /*let flag = 0;
            for (let para of paraList) {
                if (seg.vbind == para) {
                    scripts.push(`\t${tableName}.${seg.name} = argv.${seg.vbind}`);
                    flag = 1;
                }
            }
            if (flag == 0)
                scripts.push(`\t${tableName}.${seg.name} = ${seg.vbind}`);
            */
        }
    }
    scripts.push(`\t--在${prim.schannel}接口上，按照${prim.protocol}协议打包并发送table`);
    scripts.push(`\tsend(cit.${prim.schannel}, cpt.${prim.protocol}, ${tableName})`);
    //console.log(scripts);
    return scripts;


}

//获取read原语的脚本
function getReadScript(prim) {
    let scripts = [];

    scripts.push(`\tread(${prim.vchannel})`);
    return scripts;
}

//获取write原语的脚本
function getWriteScript(prim) {
    let scripts = [];

    scripts.push(`\twrite(${prim.vchannel}, argv.${prim.para})`);
    return scripts;
}

//获取delay原语的脚本
function getDelayScript(prim) {
    let scripts = [];
    scripts.push(`\tdelay(${prim.timeout})`);
    return scripts;
}

//获取print原语的脚本
//重点是获取参数，在参数前面加argv.
function getPrintScript(prim) {
    let scripts = "\tprint(";
    let args = [];
    let infos = prim.info.split(/ *, */);
    for (let i = 0; i < infos.length; i++) {
        if (infos[i].includes("\"")) {
            if (infos[i].charAt(infos[i].length - 1) != "\"") {
                let tmp = infos[i];
                i++;
                args.push(tmp + "," + infos[i]);
            } else
                args.push(infos[i]);

        } else
            args.push(infos[i]);
    }
    //console.log(args);
    for (let i = 0; i < args.length; i++) {
        if (args[i].includes("\""))
            scripts = scripts + args[i];
        else
            scripts = scripts + "argv." + args[i];

        if (i != args.length - 1)
            scripts = scripts + ", ";
        else
            scripts = scripts + ")";

    }


    return [scripts];
}

//获取reset原语的脚本
function getResetScript(prim) {
    let scripts = [];
    scripts.push(`\treset(${prim.schannel})`);
    return scripts;
}

//获取call原语的脚本
function getCallScript(prim) {
    let scripts = `\t${prim.fun}(`;
    argvs = prim.argv.split(/ *, */);
    for (let i = 0; i < argvs.length; i++) {
        scripts = scripts + "argv." + argvs[i];
        if (i != argvs.length - 1)
            scripts = scripts + ", ";
    }
    scripts = scripts + ")";
    //scripts.push(`\t${prim.fun}(${prim.argv})`);
    return [scripts];
}

//获取assert原语的脚本
function getAssertScript(prim) {
    let scripts = [];
    switch (prim.assert_type) {
        case "ok":

            //如果原语已经通过检查则这里不需要再次检查
            //仅未测试目的加入本段代码
            if (!prim.expression) {
                return scripts;
            }

            scripts.push(`\tassert.ok(${handleExp(prim.expression)}, ${'"断言\\"'+prim.expression+'\\"失败"'})`);
            break;

        case "changeHigh":
            scripts.push(`\tassert.changeHigh(${prim.vchannel}, ${prim.timeout}, ${'"断言\\"'+ prim.vchannel + '\\"接口电平值由低变高失败"'})`);
            break;

        case "changeLow":
            scripts.push(`\tassert.changeLow(${prim.vchannel}, ${prim.timeout}, ${'"断言\\"'+ prim.vchannel + '\\"接口电平值由高变低失败"'})`);
            break;

        default:
            break;
    }
    return scripts;
}

//将每个原语的脚本生成函数都放到一个字典里
const generator = {
    "recv": getRecvScript,
    "send": getSendScript,
    "assert": getAssertScript,
    "read": getReadScript,
    "write": getWriteScript,
    "delay": getDelayScript,
    "print": getPrintScript,
    "reset": getResetScript,
    "call": getCallScript,
}

//将task中的所有原语执行生成一个函数
function Primitive2Lua(task_id, prim_array, paraList) {
    let script_arr = [`function ${task_id}(argv)`];
    if (!prim_array || prim_array.length === 0) {
        return '';
    }
    //var primID = 0; //原语的ID
    let lineNum = 1; //代码行号
    let primDict = []; //查询原语用的字典
    for (let prim of prim_array) {
        let get_fun = generator[prim.action];
        if (get_fun) {
            let prim_script = [];

            prim_script = get_fun(prim.setting);

            if (prim_script && prim_script.length > 0) {
                let tmp = lineNum;
                lineNum = lineNum + prim_script.length;
                primDict.push([tmp, lineNum]);
                script_arr = script_arr.concat(prim_script);
            } else
                primDict.push([lineNum, lineNum]);
        } else {
            console.log(`未执行对<${prim.action}>原语的脚本转换`);
        }
        //primID++;
    }

    end = [`end`];
    script_arr = script_arr.concat(end);
    return [script_arr, primDict];
}

module.exports = Primitive2Lua;